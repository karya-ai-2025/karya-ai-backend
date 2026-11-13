// services/campaignLaunch.js
//
// Launching a campaign: the ICP check, the credit check, reserving the
// credits and starting the send. Shared by the two ways a campaign starts:
//
//   • someone with campaign.start presses Start (campaignController.startCampaign)
//   • the business approves a campaign_launch request (services/approvals.js),
//     which launches it straight away — the "auto-launch on approval"
//
// Credits always come from the business that owns the campaign.
//
// Returns { ok, status, code?, message, ... } — `status` is the HTTP status a
// controller should answer with when it isn't ok.

const Campaign = require('../models/Campaign');
const CampaignICP = require('../models/CampaignICP');
const UserPlan = require('../models/UserPlan');
const UserCreditConsumption = require('../models/UserCreditConsumption');
const { processCampaign } = require('./campaignProcessor');
const { BYPASS_PAYWALL } = require('../config/testingFlags');

/**
 * @param {object} campaign            Campaign document (not lean)
 * @param {object} opts
 * @param {string} opts.payingAccountId  the business's owning account (plan + credits)
 * @param {string} opts.actorUserId      who caused the launch (for the credit record)
 * @param {'strict'|'override'|'approval'} [opts.icpPolicy]
 *    strict   → needs an approved ICP (or one past its auto-approve deadline)
 *    override → Karya staff starting anyway; recorded on the campaign
 *    approval → the business approving this launch IS its sign-off on who the
 *               campaign goes to: a waiting ICP is approved with it, and a
 *               campaign without an ICP may go out
 */
async function launchCampaign(campaign, { payingAccountId, actorUserId, icpPolicy = 'strict' }) {
  if (!campaign.canBeStarted()) {
    return { ok: false, status: 400, message: 'Campaign cannot be started in current state' };
  }

  // ── ICP gate ────────────────────────────────────────────────────────────
  // The customer must have signed off on who we contact on their behalf.
  const icp = await CampaignICP.findOne({ campaignId: campaign._id });

  if (!icp) {
    if (icpPolicy === 'strict') {
      return {
        ok: false, status: 409, code: 'ICP_MISSING',
        message: 'This campaign has no ICP yet. An ICP must be created and approved before sending.',
      };
    }
  } else if (icp.status !== 'approved') {
    // The response window may have closed since the last sweep ran. Treat a
    // passed deadline as approved here too, and record the auto-approval.
    if (CampaignICP.isPastDeadline(icp)) {
      icp.status = 'approved';
      icp.approvedAt = new Date();
      icp.approvalSource = 'auto';
      icp.autoApproveAt = undefined;
      await icp.save();
    } else if (icpPolicy === 'approval') {
      icp.status = 'approved';
      icp.approvedAt = new Date();
      icp.approvalSource = 'customer';
      icp.autoApproveAt = undefined;
      await icp.save();
    } else if (icpPolicy !== 'override') {
      const hoursLeft = icp.hoursUntilAutoApprove;
      return {
        ok: false, status: 409, code: 'ICP_NOT_APPROVED',
        icpStatus: icp.status,
        hoursUntilAutoApprove: hoursLeft,
        message: icp.status === 'revision_requested'
          ? 'The customer has requested changes to this ICP. Revise it and send it back for approval before sending.'
          : `This campaign's ICP is awaiting customer approval. It will approve automatically in ${hoursLeft ?? '—'} hour(s) if they do not respond.`,
      };
    }
  }

  if (icpPolicy === 'override' && (!icp || icp.status !== 'approved')) {
    campaign.addError(
      'Admin override: campaign started without an approved ICP (status: ' + (icp ? icp.status : 'none') + ')',
      null,
      'other'
    );
  }

  // ── Credits: always the owning business's ──────────────────────────────
  const validLeads = campaign.selectedLeads.filter((lead) => lead.email && lead.email.includes('@'));
  const creditsRequired = validLeads.length * (campaign.creditsPerEmail || 1);

  const userPlans = await UserPlan.findActiveByUser(payingAccountId);
  const userPlan = userPlans && userPlans.length > 0 ? userPlans[0] : null;

  // ── PAYWALL (parked for testing — see config/testingFlags.js) ──────────
  if (!BYPASS_PAYWALL) {
    if (!userPlan) {
      return {
        ok: false, status: 402,
        message: 'No active plan found. Please subscribe to a plan to send campaigns.',
        creditsRequired, remainingCredits: 0,
      };
    }
    if (!userPlan.hasEnoughCredits(creditsRequired)) {
      const remaining = Math.max(0, userPlan.totalCredits - userPlan.creditsUsed);
      return {
        ok: false, status: 402,
        message: `Insufficient credits. You need ${creditsRequired} credits to send to ${validLeads.length} leads, but you only have ${remaining} credits remaining.`,
        creditsRequired, remainingCredits: remaining, leadsCount: validLeads.length,
      };
    }
  }

  // Reserve credits upfront in one write (whenever a plan exists, so a funded
  // account behaves exactly as in production).
  if (userPlan) {
    userPlan.creditsUsed += creditsRequired;
    await userPlan.save();
    await UserCreditConsumption.create({
      userId: payingAccountId,
      actorUserId,
      organizationId: campaign.organizationId,
      userPlanId: userPlan._id,
      actionType: 'SEND_CAMPAIGN_EMAIL',
      creditsConsumed: creditsRequired,
      leadId: `campaign_${campaign._id}`,
      metadata: {
        campaignId: campaign._id,
        campaignName: campaign.name,
        leadsCount: validLeads.length,
        creditsPerEmail: campaign.creditsPerEmail || 1,
        type: 'reserve',
      },
    });
  }

  campaign.status = 'sending';
  campaign.startedAt = new Date();
  campaign.creditsReserved = creditsRequired;
  await campaign.save();

  // Fire-and-forget: process emails in the background
  processCampaign(campaign._id).catch((err) => {
    console.error(`Background campaign processing failed for ${campaign._id}:`, err);
    Campaign.findByIdAndUpdate(campaign._id, {
      status: 'failed',
      $push: { errorLogs: { message: `Processing failed: ${err.message}`, errorType: 'sending', timestamp: new Date() } },
    }).catch(console.error);
  });

  return {
    ok: true,
    status: 200,
    message: `Campaign started — ${creditsRequired} credits reserved for ${validLeads.length} emails`,
    creditsReserved: creditsRequired,
    remainingCredits: userPlan ? Math.max(0, userPlan.totalCredits - userPlan.creditsUsed) : 0,
  };
}

module.exports = { launchCampaign };
