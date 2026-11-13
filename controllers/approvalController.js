// controllers/approvalController.js
//
// The approval system's API (the logic lives in services/approvals.js):
//
//   /api/projects/:projectId/approvals   list a project's requests; a worker
//                                        asks the client a question
//   /api/approvals/:approvalId/*         one request: read, decide, comment,
//                                        withdraw
//   /api/attention                       everything waiting across all of the
//                                        caller's projects (their Attention Center)

const ApprovalRequest = require('../models/ApprovalRequest');
const Engagement = require('../models/Engagement');
const Milestone = require('../models/Milestone');
const ProjectUser = require('../models/ProjectUser');
const ProjectCatalog = require('../models/ProjectCatalog');
const Organization = require('../models/Organization');
const User = require('../models/User');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { hasCapability } = require('../middleware/orgContext');
const approvals = require('../services/approvals');

const sideOf = (req) => (req.engagement ? 'partner' : 'business');

/** Project titles + slugs for a set of ProjectUser ids. */
async function projectNames(ids) {
  const projects = await ProjectUser.find({ _id: { $in: ids.filter(Boolean) } }).select('projectSlug catalogId').lean();
  const catalogs = await ProjectCatalog.find({ _id: { $in: projects.map((p) => p.catalogId).filter(Boolean) } }).select('title').lean();
  const titleOf = new Map(catalogs.map((c) => [String(c._id), c.title]));
  return new Map(projects.map((p) => [String(p._id), { _id: p._id, slug: p.projectSlug, title: titleOf.get(String(p.catalogId)) || p.projectSlug }]));
}

/** What the client sees about a list of requests, from the caller's point of view. */
async function shape(req, list, { withProjects = false } = {}) {
  const userIds = list.flatMap((a) => [a.requestedBy, a.decidedBy, ...(a.comments || []).map((c) => c.userId)]);
  const orgIds = list.map((a) => a.requestedByOrgId);
  const [users, orgs, projects] = await Promise.all([
    User.find({ _id: { $in: userIds.filter(Boolean) } }).select('fullName').lean(),
    Organization.find({ _id: { $in: orgIds.filter(Boolean) } }).select('name').lean(),
    withProjects ? projectNames(list.map((a) => a.projectInstanceId)) : new Map(),
  ]);
  const nameOf = new Map(users.map((u) => [String(u._id), u.fullName]));
  const orgOf = new Map(orgs.map((o) => [String(o._id), o.name]));
  const mySide = sideOf(req);

  return list.map((a) => ({
    _id: a._id,
    type: a.type,
    typeLabel: approvals.TYPE_LABEL[a.type],
    title: a.title,
    description: a.description,
    status: a.status,
    target: a.target || null,
    payload: a.payload || {},
    side: a.side,
    requestedBy: nameOf.get(String(a.requestedBy)) || null,
    requestedByOrg: orgOf.get(String(a.requestedByOrgId)) || null,
    requestedAt: a.createdAt,
    updatedAt: a.updatedAt,
    decidedBy: nameOf.get(String(a.decidedBy)) || null,
    decidedAt: a.decidedAt || null,
    decisionNote: a.decisionNote || '',
    outcome: a.outcome || null,
    comments: (a.comments || []).map((c) => ({ _id: c._id, by: nameOf.get(String(c.userId)) || '', side: c.side, text: c.text, at: c.at })),
    project: withProjects ? projects.get(String(a.projectInstanceId)) || null : undefined,
    canDecide: a.status === 'pending' && mySide === 'business' && hasCapability(req, approvals.DECIDE_CAPABILITY[a.type]),
    canCancel: a.status === 'pending' && a.side === mySide,
  }));
}

// ── Inside a project (/api/projects/:projectId/approvals) ────────────────────

/**
 * @route   GET /api/projects/:projectId/approvals
 */
const listProjectApprovals = asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  const list = await ApprovalRequest.find({
    projectInstanceId: req.project._id,
    $or: [{ status: 'pending' }, { updatedAt: { $gte: since } }],
  }).sort({ createdAt: -1 }).limit(200).lean();
  const items = await shape(req, list);
  // Waiting first, then newest
  items.sort((a, b) => (b.status === 'pending') - (a.status === 'pending') || new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json({
    success: true,
    data: {
      items,
      canAsk: hasCapability(req, 'plan.edit'),
      canDecide: hasCapability(req, 'campaign.approve'),
    },
  });
});

/**
 * @desc    The people doing the work ask the client a question
 *          { title, description }. (Campaign launches are raised by
 *          submitting the campaign.)
 * @route   POST /api/projects/:projectId/approvals
 */
const createProjectApproval = asyncHandler(async (req, res, next) => {
  if (!hasCapability(req, 'plan.edit')) return next(new AppError('Only the people doing the work can ask the client questions here', 403));
  const title = String(req.body.title || '').trim();
  if (title.length < 3) return next(new AppError('Write the question you need answered', 400));
  const approval = await approvals.requestApproval(req, {
    type: 'decision',
    title,
    description: String(req.body.description || '').trim(),
  });
  const [shaped] = await shape(req, [approval.toObject()]);
  res.status(201).json({ success: true, data: { approval: shaped } });
});

// ── One request (/api/approvals/:approvalId) ─────────────────────────────────

/** Loaded by the route middleware after access was checked. */
const one = async (req) => ApprovalRequest.findById(req.approval._id);

const getApproval = asyncHandler(async (req, res) => {
  const [shaped] = await shape(req, [(await one(req)).toObject()], { withProjects: true });
  res.json({ success: true, data: { approval: shaped } });
});

/**
 * @route   POST /api/approvals/:approvalId/decision   { decision: approve|reject|changes, note }
 */
const decideApproval = asyncHandler(async (req, res) => {
  const decided = await approvals.decide(req, await one(req), req.body.decision, req.body.note);
  const [shaped] = await shape(req, [decided.toObject()], { withProjects: true });
  res.json({ success: true, message: decided.outcome?.message || 'Decision recorded', data: { approval: shaped } });
});

const commentApproval = asyncHandler(async (req, res) => {
  const updated = await approvals.addComment(req, await one(req), req.body.text);
  const [shaped] = await shape(req, [updated.toObject()], { withProjects: true });
  res.json({ success: true, data: { approval: shaped } });
});

const cancelApproval = asyncHandler(async (req, res) => {
  const updated = await approvals.cancel(req, await one(req));
  const [shaped] = await shape(req, [updated.toObject()], { withProjects: true });
  res.json({ success: true, data: { approval: shaped } });
});

// ── Attention Center (/api/attention) ────────────────────────────────────────

/**
 * @desc    Everything waiting, across all the caller's projects.
 *   business → requests waiting for its decision (if its role decides), and
 *              its own requests' recent outcomes
 *   partner  → invitations to answer, what it's waiting on, what the client
 *              decided recently (changes requested first), and milestones due
 * @route   GET /api/attention
 */
const getAttention = asyncHandler(async (req, res) => {
  const recent = new Date(Date.now() - 14 * 24 * 3600 * 1000);

  if (req.user.kind === 'business') {
    const waiting = await ApprovalRequest.find({ organizationId: req.organizationId, status: 'pending' }).sort({ createdAt: 1 }).lean();
    const decidedRecently = await ApprovalRequest.find({ organizationId: req.organizationId, status: { $ne: 'pending' }, decidedAt: { $gte: recent } })
      .sort({ decidedAt: -1 }).limit(20).lean();
    const shapedWaiting = await shape(req, waiting, { withProjects: true });
    res.json({
      success: true,
      data: {
        side: 'business',
        needsYou: shapedWaiting.filter((a) => a.canDecide),
        waitingOnOthers: shapedWaiting.filter((a) => !a.canDecide),
        decided: await shape(req, decidedRecently, { withProjects: true }),
      },
    });
    return;
  }

  // Partner: only through its engagements
  const leads = ['admin', 'manager'].includes(req.membership?.role);
  const engagementFilter = { partnerOrgId: req.organizationId, status: 'active' };
  if (!leads) engagementFilter['members.userId'] = req.user._id;
  const engagements = await Engagement.find(engagementFilter).select('_id projectInstanceId businessOrgId').lean();
  const projectIds = engagements.map((e) => e.projectInstanceId);
  const engagementByProject = new Map(engagements.map((e) => [String(e.projectInstanceId), e._id]));

  const invitationCount = leads
    ? await Engagement.countDocuments({
      status: 'invited',
      inviteExpires: { $gt: new Date() },
      $or: [{ partnerOrgId: req.organizationId }, { partnerOrgId: null, invitedEmail: String(req.user.email).toLowerCase() }],
    })
    : 0;

  const [waiting, decided, milestones] = await Promise.all([
    ApprovalRequest.find({ projectInstanceId: { $in: projectIds }, requestedByOrgId: req.organizationId, status: 'pending' }).sort({ createdAt: -1 }).lean(),
    ApprovalRequest.find({ projectInstanceId: { $in: projectIds }, requestedByOrgId: req.organizationId, status: { $in: ['approved', 'rejected', 'changes_requested'] }, decidedAt: { $gte: recent } })
      .sort({ decidedAt: -1 }).limit(30).lean(),
    Milestone.find({ projectInstanceId: { $in: projectIds }, status: { $ne: 'done' }, dueDate: { $ne: null, $lte: new Date(Date.now() + 7 * 24 * 3600 * 1000) } })
      .sort({ dueDate: 1 }).lean(),
  ]);
  const names = await projectNames(milestones.map((m) => m.projectInstanceId));
  const decidedShaped = await shape(req, decided, { withProjects: true });
  decidedShaped.sort((a, b) => (b.status === 'changes_requested') - (a.status === 'changes_requested'));
  const withEngagement = (x) => ({ ...x, engagementId: x.project ? engagementByProject.get(String(x.project._id)) || null : null });

  res.json({
    success: true,
    data: {
      side: 'partner',
      invitationCount,
      waitingOnClient: (await shape(req, waiting, { withProjects: true })).map(withEngagement),
      decided: decidedShaped.map(withEngagement),
      milestonesDue: milestones.map((m) => ({
        _id: m._id,
        title: m.title,
        dueDate: m.dueDate,
        status: m.status,
        overdue: new Date(m.dueDate) < new Date(),
        project: names.get(String(m.projectInstanceId)) || null,
        engagementId: engagementByProject.get(String(m.projectInstanceId)) || null,
      })),
    },
  });
});

module.exports = {
  listProjectApprovals,
  createProjectApproval,
  getApproval,
  decideApproval,
  commentApproval,
  cancelApproval,
  getAttention,
};
