// controllers/icpController.js
// Ideal Customer Profiles — one per campaign.
//
// Admins author them; customers approve them or send back a suggestion.
// A campaign cannot start sending until its ICP is approved (see startCampaign).
//
// Ownership rule: a customer only ever sees ICPs whose campaign belongs to them.
// Every customer-facing query filters on req.user._id — never on a body field.

const CampaignICP = require('../models/CampaignICP');
const Campaign = require('../models/Campaign');
// Registered so the nested populate of the campaign's template resolves,
// regardless of which routes happen to have loaded first.
require('../models/EmailTemplate');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

const FILTER_KEYS = ['industry', 'location', 'seniority', 'segment', 'companySegment', 'company'];

/** Accept either an array or a comma-separated string for each filter field. */
function normaliseFilters(input = {}) {
  const out = {};
  for (const key of FILTER_KEYS) {
    const val = input[key];
    if (val == null) continue;
    const arr = Array.isArray(val) ? val : String(val).split(',');
    const cleaned = arr.map((v) => String(v).trim()).filter(Boolean);
    if (cleaned.length) out[key] = cleaned;
  }
  return out;
}

/**
 * Keep the sequence to the four defined steps, in order.
 *
 * The step/key/audience of each stage is structure, not content — the admin
 * edits the subject and body, never the shape — so those are taken from the
 * canonical defaults and only the copy comes from the request. That stops a
 * malformed payload from producing a sequence the sender cannot execute.
 */
function normaliseSequence(input) {
  const defaults = CampaignICP.defaultSequence();
  const byKey = new Map(
    (Array.isArray(input) ? input : []).map((s) => [s && s.key, s])
  );

  return defaults.map((def) => {
    const given = byKey.get(def.key) || {};
    const delay = Number(given.delayHours);
    return {
      ...def,
      subject: String(given.subject ?? '').trim().slice(0, 300),
      body: String(given.body ?? '').slice(0, 20000),
      // Timing is the one structural field the admin may tune.
      delayHours: Number.isFinite(delay) && delay >= 0 ? Math.min(delay, 2160) : def.delayHours,
    };
  });
}

/** Older ICPs predate the sequence — hand back the default shape so the UI always has four steps. */
function withSequence(icp) {
  if (!icp) return icp;
  const plain = typeof icp.toObject === 'function' ? icp.toObject({ virtuals: true }) : icp;
  if (!plain.sequence || plain.sequence.length === 0) {
    plain.sequence = CampaignICP.defaultSequence();
  }
  return plain;
}

// ─── Customer endpoints ───────────────────────────────────────────────────────

/**
 * GET /api/icp
 * Every ICP belonging to the signed-in customer, newest first.
 * Scoped by userId, so another customer's ICP can never be returned.
 */
const listMyICPs = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const icps = await CampaignICP.find({ userId, status: { $ne: 'archived' } })
    .populate({ path: 'campaignId', select: 'name status parentCampaignId isParent emailTemplateId', populate: { path: 'emailTemplateId', select: 'templateName subject emailBody' } })
    .sort({ updatedAt: -1 });

  res.json({ success: true, count: icps.length, data: icps.map(withSequence) });
});

/**
 * GET /api/icp/:campaignId
 * One ICP. 404 (not 403) when the campaign isn't theirs — don't confirm it exists.
 */
const getICPForCampaign = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  const campaign = await Campaign.findOne({ _id: req.params.campaignId, userId }).lean();
  if (!campaign) return next(new AppError('Campaign not found', 404));

  const icp = await CampaignICP.findOne({ campaignId: campaign._id })
    .populate({ path: 'campaignId', select: 'name status parentCampaignId isParent emailTemplateId', populate: { path: 'emailTemplateId', select: 'templateName subject emailBody' } });

  if (!icp) return next(new AppError('No ICP has been created for this campaign yet', 404));

  res.json({ success: true, data: withSequence(icp) });
});

/**
 * PATCH /api/icp/:campaignId/review
 * The customer's two buttons.
 *   { action: 'approve' }
 *   { action: 'request_changes', note: '...' }   <- the suggestion box
 */
const reviewICP = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  const { action, note = '' } = req.body;

  if (!['approve', 'request_changes'].includes(action)) {
    return next(new AppError('action must be approve or request_changes', 400));
  }
  if (action === 'request_changes' && !String(note).trim()) {
    return next(new AppError('Please describe what you would like changed', 400));
  }

  const campaign = await Campaign.findOne({ _id: req.params.campaignId, userId }).lean();
  if (!campaign) return next(new AppError('Campaign not found', 404));

  const icp = await CampaignICP.findOne({ campaignId: campaign._id });
  if (!icp) return next(new AppError('No ICP has been created for this campaign yet', 404));

  // Only an ICP that has actually been sent for review can be acted on.
  if (!['awaiting_user', 'revision_requested'].includes(icp.status)) {
    return next(new AppError('This ICP is not awaiting your review (status: ' + icp.status + ')', 400));
  }

  if (action === 'approve') {
    icp.status = 'approved';
    icp.approvedAt = new Date();
    icp.approvalSource = 'customer';
    icp.autoApproveAt = undefined;
    icp.customerNote = '';
  } else {
    icp.status = 'revision_requested';
    icp.customerNote = String(note).trim();
    icp.revisionCount += 1;
    icp.approvedAt = undefined;
    // They responded, so the deadline no longer applies — it is the admin's turn.
    icp.autoApproveAt = undefined;
  }

  await icp.save();

  res.json({
    success: true,
    message: action === 'approve' ? 'ICP approved' : 'Your suggestion has been sent',
    data: icp,
  });
});

// ─── Admin endpoints ──────────────────────────────────────────────────────────

/**
 * GET /api/icp/admin/list?status=revision_requested
 * Every ICP across all customers. Items the customer has sent back sort first,
 * so the admin's own page doubles as the work queue.
 */
const adminListICPs = asyncHandler(async (req, res) => {
  const { status, userId } = req.query;
  const query = {};
  if (status) query.status = status;
  if (userId) query.userId = userId;

  const icps = await CampaignICP.find(query)
    .populate({ path: 'campaignId', select: 'name status parentCampaignId isParent emailTemplateId', populate: { path: 'emailTemplateId', select: 'templateName subject emailBody' } })
    .populate('userId', 'fullName email')
    .sort({ updatedAt: -1 })
    .lean({ virtuals: true });

  // Customer-requested changes are what the admin has to act on — float them up.
  icps.sort((a, b) => {
    const rank = (s) => (s === 'revision_requested' ? 0 : s === 'draft' ? 1 : 2);
    return rank(a.status) - rank(b.status);
  });

  res.json({ success: true, count: icps.length, data: icps.map(withSequence) });
});

/**
 * POST /api/icp/admin/:campaignId
 * Create the ICP for a campaign. One per campaign — use PUT to revise.
 */
const adminCreateICP = asyncHandler(async (req, res, next) => {
  const { name, summary = '', filters = {}, sequence, sendForReview = true } = req.body;

  if (!name || !String(name).trim()) {
    return next(new AppError('ICP name is required', 400));
  }

  const campaign = await Campaign.findById(req.params.campaignId).lean();
  if (!campaign) return next(new AppError('Campaign not found', 404));

  const existing = await CampaignICP.findOne({ campaignId: campaign._id }).lean();
  if (existing) {
    return next(new AppError('This campaign already has an ICP — update it instead', 409));
  }

  const icp = await CampaignICP.create({
    campaignId: campaign._id,
    userId: campaign.userId, // inherited, never taken from the request
    name: String(name).trim(),
    summary: String(summary).trim(),
    filters: normaliseFilters(filters),
    // Always the full four steps, even if the admin only wrote the first one —
    // the customer is approving the whole sequence, so it must all be present.
    sequence: normaliseSequence(sequence),
    status: sendForReview ? 'awaiting_user' : 'draft',
    sentForReviewAt: sendForReview ? new Date() : undefined,
    // The clock starts when the customer is actually asked.
    autoApproveAt: sendForReview ? CampaignICP.nextAutoApproveAt() : undefined,
    createdByAdmin: req.user._id,
  });

  res.status(201).json({ success: true, data: withSequence(icp) });
});

/**
 * PUT /api/icp/admin/:campaignId
 * Revise an ICP — typically in response to a customer's suggestion.
 * The previous version is pushed into revisions[] before anything is overwritten.
 */
const adminUpdateICP = asyncHandler(async (req, res, next) => {
  const { name, summary, filters, sequence, adminNote = '', sendForReview = true } = req.body;

  const icp = await CampaignICP.findOne({ campaignId: req.params.campaignId });
  if (!icp) return next(new AppError('No ICP found for this campaign', 404));

  // Preserve what the customer asked for and what it looked like before.
  icp.snapshot();

  if (name != null) icp.name = String(name).trim();
  if (summary != null) icp.summary = String(summary).trim();
  if (filters != null) icp.filters = normaliseFilters(filters);
  if (sequence != null) icp.sequence = normaliseSequence(sequence);

  icp.adminNote = String(adminNote).trim();

  if (sendForReview) {
    // Back to the customer for another look; their old note is now history.
    icp.status = 'awaiting_user';
    icp.sentForReviewAt = new Date();
    icp.autoApproveAt = CampaignICP.nextAutoApproveAt();
    icp.customerNote = '';
    icp.approvedAt = undefined;
    icp.approvalSource = undefined;
  }

  await icp.save();

  res.json({ success: true, data: withSequence(icp) });
});

/**
 * DELETE /api/icp/admin/:campaignId
 * Archive rather than delete — the campaign may already have sent against it.
 */
const adminArchiveICP = asyncHandler(async (req, res, next) => {
  const icp = await CampaignICP.findOne({ campaignId: req.params.campaignId });
  if (!icp) return next(new AppError('No ICP found for this campaign', 404));

  icp.status = 'archived';
  await icp.save();

  res.json({ success: true, message: 'ICP archived', data: icp });
});

/**
 * GET /api/icp/admin/campaigns?q=fintech
 * Every campaign across all customers, so the admin can pick one to attach an
 * ICP to. Flags whether each already has an ICP, and what state it is in.
 */
const adminListCampaigns = asyncHandler(async (req, res) => {
  const { q } = req.query;
  const query = {};
  if (q) query.name = { $regex: String(q).trim(), $options: 'i' };

  const campaigns = await Campaign.find(query)
    .select('name status userId parentCampaignId isParent createdAt emailTemplateId sequenceTemplates')
    .populate('userId', 'fullName email')
    // The ICP form seeds its four emails from these, so the admin reviews copy
    // the customer already wrote rather than starting from four empty boxes.
    .populate('emailTemplateId', 'templateName subject emailBody')
    .populate('sequenceTemplates.templateId', 'templateName subject emailBody')
    .sort({ createdAt: -1 })
    .limit(300)
    .lean();

  // One query for all ICPs rather than one per campaign.
  const icps = await CampaignICP.find({
    campaignId: { $in: campaigns.map((c) => c._id) },
  }).select('campaignId status name').lean();

  const byCampaign = new Map(icps.map((i) => [String(i.campaignId), i]));

  const data = campaigns.map((c) => ({
    ...c,
    icp: byCampaign.get(String(c._id)) || null,
  }));

  res.json({ success: true, count: data.length, data });
});

module.exports = {
  listMyICPs,
  getICPForCampaign,
  reviewICP,
  adminListICPs,
  adminListCampaigns,
  adminCreateICP,
  adminUpdateICP,
  adminArchiveICP,
};
