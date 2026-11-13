// services/approvals.js
//
// The one approval system (models/ApprovalRequest.js). Every way of asking
// the client for a decision, and every way the client decides, goes through
// here — so a campaign approved from the campaign list, from the Approvals
// tab or from the Attention Center behaves exactly the same.
//
//   requestApproval  raise (or re-raise) a request
//   decide           the business approves / rejects / asks for changes, and
//                    the decision takes effect: an approved campaign launches
//                    (from the business's credits)
//   addComment       either side, on the request's thread
//   cancel           the side that asked withdraws it

const crypto = require('crypto');
const ApprovalRequest = require('../models/ApprovalRequest');
const Campaign = require('../models/Campaign');
const EmailTemplate = require('../models/EmailTemplate');
const Organization = require('../models/Organization');
const Membership = require('../models/Membership');
const User = require('../models/User');
const { AppError } = require('../middleware/errorHandler');
const { hasCapability } = require('../middleware/orgContext');
const { launchCampaign } = require('./campaignLaunch');
const { audit } = require('../utils/audit');
const { sendEmail, templates } = require('../utils/sendEmail');
const { config } = require('../config/config');

const TYPE_LABEL = {
  campaign_launch: 'Campaign launch',
  decision: 'Question',
};

// What deciding each type needs (the business's admins and managers).
// Workers never hold it.
const DECIDE_CAPABILITY = {
  campaign_launch: 'campaign.approve',
  decision: 'campaign.approve',
};

const sideOf = (req) => (req.engagement ? 'partner' : 'business');
const businessOrgOf = (req) => (req.engagement ? req.engagement.businessOrgId : req.organizationId);

/**
 * A fingerprint of everything a campaign would send: who to, which emails,
 * and the emails' actual text. Approval is for exactly this; if any of it
 * changes afterwards, the approval no longer applies.
 */
async function hashCampaign(campaign) {
  const templateIds = [
    campaign.emailTemplateId?._id || campaign.emailTemplateId,
    ...(campaign.sequenceTemplates || []).map((s) => s.templateId),
  ].filter(Boolean).map(String);
  const tpls = await EmailTemplate.find({ _id: { $in: templateIds } }).select('subject emailBody').lean();
  const byId = new Map(tpls.map((t) => [String(t._id), [t.subject, t.emailBody]]));
  const body = JSON.stringify({
    name: campaign.name,
    template: String(campaign.emailTemplateId?._id || campaign.emailTemplateId || ''),
    sequence: (campaign.sequenceTemplates || []).map((s) => [s.key, String(s.templateId)]),
    texts: templateIds.map((id) => byId.get(id) || null),
    leads: (campaign.selectedLeads || []).map((l) => String(l.email || '').toLowerCase()).sort(),
    settings: campaign.settings || {},
  });
  return crypto.createHash('sha256').update(body).digest('hex');
}

// ── Notifications (email; the Attention Centers show the same in the app) ───

const projectLink = (approval, side) => (side === 'business'
  ? `${config.frontendUrl}/business-dashboard/attention`
  : `${config.frontendUrl}/partner/attention`);

async function notifyDeciders(approval) {
  try {
    const org = await Organization.findById(approval.organizationId).select('name').lean();
    const deciders = await Membership.find({ organizationId: approval.organizationId, status: 'active', role: { $in: ['admin', 'manager'] } })
      .populate('userId', 'email preferences').lean();
    const to = deciders.map((m) => m.userId).filter((u) => u?.email && u.preferences?.emailNotifications !== false).map((u) => u.email);
    if (!to.length) return;
    await Promise.all(to.map((email) => sendEmail({
      to: email,
      subject: `Needs your decision: ${approval.title}`,
      html: templates.approvalRequested(org?.name || '', TYPE_LABEL[approval.type], approval.title, approval.description, projectLink(approval, 'business')),
    }).catch(() => {})));
  } catch (error) {
    console.error('Approval notification failed:', error.message);
  }
}

async function notifyRequester(approval) {
  try {
    const user = await User.findById(approval.requestedBy).select('email preferences').lean();
    if (!user?.email || user.preferences?.emailNotifications === false) return;
    await sendEmail({
      to: user.email,
      subject: `${approval.status === 'approved' ? 'Approved' : approval.status === 'rejected' ? 'Not approved' : 'Changes requested'}: ${approval.title}`,
      html: templates.approvalDecided(TYPE_LABEL[approval.type], approval.title, approval.status, approval.decisionNote, approval.outcome?.message || '', projectLink(approval, approval.side)),
    });
  } catch (error) {
    console.error('Approval decision notification failed:', error.message);
  }
}

// ── Raise ────────────────────────────────────────────────────────────────────

/**
 * Raise a request — or, for the same campaign, refresh the one already waiting (a resubmission replaces what is being approved and keeps
 * the comment thread).
 */
async function requestApproval(req, { type, title, description = '', target = null, payload = {}, contentHash = null, projectInstanceId, quiet = false }) {
  const projectId = projectInstanceId !== undefined ? projectInstanceId : (req.project?._id || null);

  if (target?.id && type === 'campaign_launch') {
    const waiting = await ApprovalRequest.findOne({ type, 'target.id': target.id, status: 'pending' });
    if (waiting) {
      waiting.title = String(title).slice(0, 200);
      waiting.contentHash = contentHash;
      waiting.payload = payload;
      waiting.requestedBy = req.user._id;
      waiting.side = sideOf(req);
      await waiting.save();
      return waiting;
    }
  }

  const approval = await ApprovalRequest.create({
    organizationId: businessOrgOf(req),
    projectInstanceId: projectId,
    engagementId: req.engagement?._id || null,
    type,
    title: String(title).slice(0, 200),
    description: String(description || '').slice(0, 4000),
    target,
    payload,
    contentHash,
    requestedBy: req.user._id,
    requestedByOrgId: req.organizationId,
    side: sideOf(req),
  });

  // `quiet`: the caller already recorded the action (e.g. "submitted the milestone")
  if (!quiet) await audit(req, 'approval.requested', {
    tenantOrgId: approval.organizationId,
    projectInstanceId: approval.projectInstanceId,
    target: { type: 'ApprovalRequest', id: approval._id },
    summary: `${req.user.fullName} asked for a decision: ${TYPE_LABEL[type].toLowerCase()} — "${approval.title}"`,
  });
  await notifyDeciders(approval);
  return approval;
}

// ── Decide ───────────────────────────────────────────────────────────────────

const OUTCOME = { approve: 'approved', reject: 'rejected', changes: 'changes_requested' };

/**
 * The business decides. Throws AppError on anything it may not do.
 * @param {'approve'|'reject'|'changes'} decision
 */
async function decide(req, approval, decision, note = '') {
  const status = OUTCOME[decision];
  if (!status) throw new AppError('Unknown decision', 400);
  if (req.engagement || String(approval.organizationId) !== String(req.organizationId)) {
    throw new AppError('Only the client can decide this', 403);
  }
  if (!hasCapability(req, DECIDE_CAPABILITY[approval.type])) {
    throw new AppError('Your role can\'t decide this', 403);
  }
  if (approval.status !== 'pending') throw new AppError('This has already been decided', 409);
  const cleanNote = String(note || '').trim().slice(0, 2000);
  if (status === 'changes_requested' && !cleanNote) {
    throw new AppError('Add a note saying what needs to change', 400);
  }

  let outcome = null;

  if (approval.type === 'campaign_launch') {
    const campaign = await Campaign.findOne({ _id: approval.target?.id, organizationId: approval.organizationId }).populate('emailTemplateId');
    if (!campaign) throw new AppError('The campaign no longer exists', 404);

    if (status === 'approved') {
      if (approval.contentHash && approval.contentHash !== await hashCampaign(campaign)) {
        approval.status = 'cancelled';
        approval.decisionNote = 'The campaign was changed after it was sent for approval. It needs to be sent again.';
        await approval.save();
        campaign.approval = { status: 'none' };
        await campaign.save();
        throw new AppError('This campaign was changed after it was sent for approval, so this approval no longer applies. Ask for it to be sent again.', 409);
      }
      campaign.approval = {
        status: 'approved',
        requestedBy: approval.requestedBy,
        requestedAt: approval.createdAt,
        decidedBy: req.user._id,
        decidedAt: new Date(),
        note: cleanNote.slice(0, 500),
      };
      await campaign.save();

      // Approving launches it, paid from the business's credits. Approving
      // also stands for the business's sign-off on who it goes to.
      const owner = await Organization.findById(approval.organizationId).select('ownerUserId').lean();
      const launched = await launchCampaign(campaign, {
        payingAccountId: owner.ownerUserId,
        actorUserId: req.user._id,
        icpPolicy: 'approval',
      });
      outcome = { launched: launched.ok, message: launched.ok ? launched.message : `Approved, but not sent: ${launched.message}` };
    } else {
      campaign.approval = {
        status: 'rejected',
        requestedBy: approval.requestedBy,
        requestedAt: approval.createdAt,
        decidedBy: req.user._id,
        decidedAt: new Date(),
        note: cleanNote.slice(0, 500),
      };
      await campaign.save();
    }
  }

  approval.status = status;
  approval.decidedBy = req.user._id;
  approval.decidedAt = new Date();
  approval.decisionNote = cleanNote;
  approval.outcome = outcome;
  await approval.save();

  const verb = status === 'approved' ? 'approved' : status === 'rejected' ? 'declined' : 'asked for changes to';
  await audit(req, `approval.${status}`, {
    tenantOrgId: approval.organizationId,
    projectInstanceId: approval.projectInstanceId,
    target: { type: 'ApprovalRequest', id: approval._id },
    summary: `${req.user.fullName} ${verb} ${TYPE_LABEL[approval.type].toLowerCase()}: "${approval.title}"${outcome?.launched ? ' — campaign launched' : ''}`,
  });
  await notifyRequester(approval);
  return approval;
}

// ── Comment / cancel ─────────────────────────────────────────────────────────

async function addComment(req, approval, text) {
  const clean = String(text || '').trim();
  if (!clean) throw new AppError('Write a comment first', 400);
  approval.comments.push({ userId: req.user._id, side: sideOf(req), text: clean.slice(0, 2000) });
  await approval.save();
  await audit(req, 'approval.commented', {
    tenantOrgId: approval.organizationId,
    projectInstanceId: approval.projectInstanceId,
    target: { type: 'ApprovalRequest', id: approval._id },
    summary: `${req.user.fullName} commented on "${approval.title}"`,
  });
  return approval;
}

async function cancel(req, approval) {
  if (approval.status !== 'pending') throw new AppError('This has already been decided', 409);
  // The side that asked may withdraw it
  if (approval.side !== sideOf(req)) throw new AppError('Only the side that asked can withdraw this', 403);
  approval.status = 'cancelled';
  await approval.save();
  if (approval.type === 'campaign_launch') {
    await Campaign.updateOne({ _id: approval.target?.id, 'approval.status': 'pending' }, { $set: { 'approval.status': 'none' } });
  }
  await audit(req, 'approval.cancelled', {
    tenantOrgId: approval.organizationId,
    projectInstanceId: approval.projectInstanceId,
    target: { type: 'ApprovalRequest', id: approval._id },
    summary: `${req.user.fullName} withdrew "${approval.title}"`,
  });
  return approval;
}

/** The waiting request for a campaign, if any. */
const pendingFor = (type, targetId) => ApprovalRequest.findOne({ type, 'target.id': targetId, status: 'pending' });

module.exports = { requestApproval, decide, addComment, cancel, hashCampaign, pendingFor, TYPE_LABEL, DECIDE_CAPABILITY };
