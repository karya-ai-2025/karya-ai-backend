// controllers/engagementController.js
//
// The business's side of bringing a worker (agency / third-party expert) into
// one of its projects: invite, see who is on the project, change what they may
// do, pause / resume / end, withdraw an invitation, get a fresh join link.
//
// Everything is behind kindGate('business') + protect + requireOrg, and the
// project and engagement are always looked up within the caller's own company.

const mongoose = require('mongoose');
const Engagement = require('../models/Engagement');
const ProjectUser = require('../models/ProjectUser');
const ProjectCatalog = require('../models/ProjectCatalog');
const Organization = require('../models/Organization');
const User = require('../models/User');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { accountUserId } = require('../middleware/orgContext');
const { DEFAULT_GRANTS, cleanGrants } = require('../config/permissions');
const { sendEmail, templates } = require('../utils/sendEmail');
const { config } = require('../config/config');
const { audit } = require('../utils/audit');

const OPEN_STATUSES = ['invited', 'active', 'paused'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const joinUrlFor = (token) => `${config.frontendUrl}/partner/join/${token}`;

/** A purchased project of the caller's own company, or a 404. */
async function ownProject(req, projectId) {
  if (!projectId || !mongoose.Types.ObjectId.isValid(String(projectId))) {
    throw new AppError('Project not found', 404);
  }
  const project = await ProjectUser.findOne({ _id: projectId, userId: accountUserId(req) })
    .select('_id projectSlug catalogId')
    .lean();
  if (!project) throw new AppError('Project not found', 404);
  return project;
}

async function projectTitle(project) {
  if (!project.catalogId) return project.projectSlug;
  const catalog = await ProjectCatalog.findById(project.catalogId).select('title').lean();
  return catalog?.title || project.projectSlug;
}

/** An engagement on one of the caller's company's projects, or a 404. */
async function ownEngagement(req, id) {
  if (!mongoose.Types.ObjectId.isValid(String(id))) throw new AppError('Not found', 404);
  const engagement = await Engagement.findOne({ _id: id, businessOrgId: req.organizationId });
  if (!engagement) throw new AppError('Not found', 404);
  return engagement;
}

/** What the business sees about one engagement. */
async function shapeForBusiness(engagements) {
  const orgIds = [...new Set(engagements.map((e) => e.partnerOrgId).filter(Boolean).map(String))];
  const orgs = orgIds.length
    ? await Organization.find({ _id: { $in: orgIds } }).select('name profile.verified profile.teamSize').lean()
    : [];
  const orgById = new Map(orgs.map((o) => [String(o._id), o]));
  return engagements.map((e) => {
    const org = e.partnerOrgId ? orgById.get(String(e.partnerOrgId)) : null;
    return {
      _id: e._id,
      status: e.status,
      invitedEmail: e.invitedEmail,
      partner: org
        ? { name: org.name, verified: !!org.profile?.verified, isSolo: org.profile?.teamSize === '1' }
        : null,
      grants: e.grants,
      memberCount: (e.members || []).length,
      message: e.message || '',
      invitedAt: e.createdAt,
      inviteExpires: e.status === 'invited' ? e.inviteExpires : null,
      acceptedAt: e.acceptedAt || null,
      pausedAt: e.pausedAt || null,
      endedAt: e.endedAt || null,
    };
  });
}

async function sendInviteEmail(req, engagement, title, joinUrl) {
  try {
    const result = await sendEmail({
      to: engagement.invitedEmail,
      subject: `${req.organization.name} invited you to work on ${title} on Karya-AI`,
      html: templates.projectInvite(req.user.fullName, req.organization.name, title, engagement.message, joinUrl),
    });
    return !!(result && result.success !== false);
  } catch (error) {
    console.error('Project invitation email failed:', error.message);
    return false;
  }
}

/**
 * @desc    Invite a worker (agency / expert) to one of the company's projects
 * @route   POST /api/engagements   { projectId, email, message?, grants? }
 * @access  partners.manage
 *
 * Returns the join link as well as emailing it, so the business can also
 * share it directly. The link is only an invitation: accepting it still needs
 * the worker's own partner login.
 */
const inviteWorker = asyncHandler(async (req, res, next) => {
  const { projectId, message } = req.body;
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return next(new AppError('Enter the email address of the agency or expert', 400));

  const project = await ownProject(req, projectId);

  // Accounts are one kind for life: a business account can't work as a partner.
  const existing = await User.findOne({ email }).select('kind organizationId').lean();
  if (existing && existing.kind !== 'partner') {
    return next(new AppError(
      'That email belongs to a business account. Agencies and experts need a partner account — ask them for the email they use (or will use) as a partner.',
      400
    ));
  }
  const partnerOrgId = existing ? existing.organizationId : null;

  const duplicate = await Engagement.findOne({
    projectInstanceId: project._id,
    status: { $in: OPEN_STATUSES },
    $or: [{ invitedEmail: email }, ...(partnerOrgId ? [{ partnerOrgId }] : [])],
  }).lean();
  if (duplicate) {
    return next(new AppError(
      duplicate.status === 'invited'
        ? 'This agency or expert already has an invitation to this project. You can send a fresh link from the list.'
        : 'This agency or expert is already working on this project.',
      409
    ));
  }

  const engagement = new Engagement({
    businessOrgId: req.organizationId,
    projectInstanceId: project._id,
    projectSlug: project.projectSlug,
    partnerOrgId,
    invitedEmail: email,
    grants: req.body.grants !== undefined ? cleanGrants(req.body.grants) : DEFAULT_GRANTS,
    message: String(message || '').trim().slice(0, 1000),
    invitedBy: req.user._id,
  });
  const token = engagement.generateInviteToken();
  await engagement.save();

  const title = await projectTitle(project);
  const joinUrl = joinUrlFor(token);
  const emailSent = await sendInviteEmail(req, engagement, title, joinUrl);

  await audit(req, 'engagement.invited', {
    target: { type: 'Engagement', id: engagement._id },
    projectInstanceId: engagement.projectInstanceId,
    summary: `${req.user.fullName} invited ${email} to ${title}`,
    details: { projectInstanceId: project._id, grants: engagement.grants },
  });

  const [shaped] = await shapeForBusiness([engagement.toObject()]);
  res.status(201).json({
    success: true,
    message: emailSent ? `Invitation sent to ${email}` : `Invitation created. The email could not be sent — share the link with ${email} yourself.`,
    data: { engagement: shaped, joinUrl, emailSent },
  });
});

/**
 * @desc    Who is invited to / working on one of the company's projects
 * @route   GET /api/engagements?projectId=
 * @access  partners.view
 */
const listEngagements = asyncHandler(async (req, res) => {
  const project = await ownProject(req, req.query.projectId);
  const engagements = await Engagement.find({ projectInstanceId: project._id, businessOrgId: req.organizationId })
    .sort({ createdAt: -1 })
    .lean();
  res.json({ success: true, data: { engagements: await shapeForBusiness(engagements) } });
});

const TRANSITIONS = {
  pause: { from: ['active'], to: 'paused', verb: 'paused' },
  resume: { from: ['paused'], to: 'active', verb: 'resumed' },
  end: { from: ['active', 'paused'], to: 'ended', verb: 'ended' },
  cancel: { from: ['invited'], to: 'cancelled', verb: 'withdrew the invitation for' },
};

/**
 * @desc    Change what a worker may do, or pause / resume / end / cancel
 * @route   PATCH /api/engagements/:id   { action?, grants? }
 * @access  partners.manage
 *
 * Pause and end take effect on the worker's very next request — access is
 * checked against the engagement every time (middleware/projectContext.js).
 */
const updateEngagement = asyncHandler(async (req, res, next) => {
  const engagement = await ownEngagement(req, req.params.id);
  const { action, grants } = req.body;

  if (action !== undefined) {
    const t = TRANSITIONS[action];
    if (!t) return next(new AppError('Unknown action', 400));
    if (!t.from.includes(engagement.status)) {
      return next(new AppError(`This can't be ${t.to} while it is ${engagement.status}`, 409));
    }
    engagement.status = t.to;
    if (action === 'pause') { engagement.pausedAt = new Date(); engagement.pausedBy = req.user._id; }
    if (action === 'resume') { engagement.pausedAt = undefined; engagement.pausedBy = undefined; }
    if (action === 'end') { engagement.endedAt = new Date(); engagement.endedBy = req.user._id; }
    if (action === 'cancel') { engagement.decidedAt = new Date(); engagement.inviteTokenHash = undefined; engagement.inviteExpires = undefined; }
  }

  if (grants !== undefined) {
    if (!OPEN_STATUSES.includes(engagement.status)) {
      return next(new AppError('This engagement is closed', 409));
    }
    engagement.grants = cleanGrants(grants);
  }

  await engagement.save();

  await audit(req, action ? `engagement.${action}` : 'engagement.grants_changed', {
    target: { type: 'Engagement', id: engagement._id },
    projectInstanceId: engagement.projectInstanceId,
    summary: action
      ? `${req.user.fullName} ${TRANSITIONS[action].verb} ${engagement.invitedEmail}'s access`
      : `${req.user.fullName} changed what ${engagement.invitedEmail} may do`,
    details: { status: engagement.status, grants: engagement.grants },
  });

  const [shaped] = await shapeForBusiness([engagement.toObject()]);
  res.json({ success: true, data: { engagement: shaped } });
});

/**
 * @desc    A fresh join link for an open invitation (the old one stops working)
 * @route   POST /api/engagements/:id/link
 * @access  partners.manage
 */
const refreshInviteLink = asyncHandler(async (req, res, next) => {
  const engagement = await ownEngagement(req, req.params.id);
  if (engagement.status !== 'invited') return next(new AppError('Only an open invitation has a link', 409));

  const token = engagement.generateInviteToken();
  await engagement.save();

  const project = await ProjectUser.findById(engagement.projectInstanceId).select('projectSlug catalogId').lean();
  const title = project ? await projectTitle(project) : engagement.projectSlug;
  const joinUrl = joinUrlFor(token);
  const emailSent = await sendInviteEmail(req, engagement, title, joinUrl);

  await audit(req, 'engagement.link_refreshed', {
    target: { type: 'Engagement', id: engagement._id },
    projectInstanceId: engagement.projectInstanceId,
    summary: `${req.user.fullName} sent a fresh link to ${engagement.invitedEmail}`,
  });

  res.json({ success: true, data: { joinUrl, emailSent, inviteExpires: engagement.inviteExpires } });
});

module.exports = { inviteWorker, listEngagements, updateEngagement, refreshInviteLink };
