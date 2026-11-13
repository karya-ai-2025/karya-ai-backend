// controllers/projectWorkspaceController.js
//
// The project workspace of the business and its workers (agencies /
// third-party experts). Milestones and tasks are the worker's own planning
// tools for their team (plan.edit) — no approval from the client; the client
// follows milestone progress (plan.view) on its dashboard. Approvals (campaign
// launches, questions) live in controllers/approvalController.js.
//
// Every route runs behind projectContext with the project taken from the URL,
// so req.project is set and:
//   • a business sees its own project
//   • a worker only gets here through an active engagement on it
// Milestones and tasks are project-level records: always queried strictly by
// req.project._id.

const mongoose = require('mongoose');
const Milestone = require('../models/Milestone');
const WorkspaceTask = require('../models/WorkspaceTask');
const Engagement = require('../models/Engagement');
const ProjectUser = require('../models/ProjectUser');
const ProjectCatalog = require('../models/ProjectCatalog');
const Organization = require('../models/Organization');
const Membership = require('../models/Membership');
const AuditEvent = require('../models/AuditEvent');
const User = require('../models/User');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { hasCapability } = require('../middleware/orgContext');
const { audit } = require('../utils/audit');

// The business's organization — the project's owner — whoever is asking
const ownerOrgId = (req) => (req.engagement ? req.engagement.businessOrgId : req.organizationId);
const viewerSide = (req) => (req.engagement ? 'worker' : 'business');
const inProject = (req) => ({ projectInstanceId: req.project._id });

const need = (req, capability, message) => {
  if (!hasCapability(req, capability)) throw new AppError(message || 'You can\'t do this in this project', 403);
};

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v));
const cleanDate = (v) => {
  if (v === null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new AppError('Invalid date', 400);
  return d;
};

/** The project's catalog entry (the brief everyone works from). */
async function catalogFor(projectId) {
  const project = await ProjectUser.findById(projectId).select('catalogId projectSlug').lean();
  const catalog = project?.catalogId
    ? await ProjectCatalog.findById(project.catalogId)
      .select('title tagline description deliverables milestones tools howItWorks kpis duration outcomes')
      .lean()
    : null;
  return { project, catalog };
}

/**
 * The first time a project's timeline is opened, start it from the catalog's
 * milestones so every project begins with a plan.
 */
async function ensureMilestones(req) {
  const existing = await Milestone.countDocuments(inProject(req));
  if (existing > 0) return;
  const { catalog } = await catalogFor(req.project._id);
  const seed = (catalog?.milestones || []).filter((m) => m && (m.label || m.description));
  if (!seed.length) return;
  await Milestone.insertMany(seed.map((m, i) => ({
    organizationId: ownerOrgId(req),
    projectInstanceId: req.project._id,
    order: i,
    title: String(m.label || `Milestone ${i + 1}`).slice(0, 140),
    description: String(m.description || '').slice(0, 2000),
    fromCatalog: true,
  })));
}

function progressOf(milestones) {
  const total = milestones.reduce((sum, m) => sum + (m.weight || 1), 0);
  const done = milestones.filter((m) => m.status === 'done').reduce((sum, m) => sum + (m.weight || 1), 0);
  const now = Date.now();
  const open = milestones.filter((m) => m.status !== 'done' && m.dueDate);
  const late = open.filter((m) => new Date(m.dueDate).getTime() < now);
  const soon = open.filter((m) => {
    const t = new Date(m.dueDate).getTime();
    return t >= now && t - now < 3 * 24 * 3600 * 1000 && m.status === 'not_started';
  });
  return {
    percent: total ? Math.round((done / total) * 100) : 0,
    done: milestones.filter((m) => m.status === 'done').length,
    total: milestones.length,
    late: late.length,
    // late → behind; due within 3 days and not even started → at risk
    health: late.length ? 'late' : soon.length ? 'at_risk' : 'on_track',
  };
}

// ── Overview ─────────────────────────────────────────────────────────────────

/**
 * @desc    The project as everyone on it sees it: the brief, who works on it,
 *          progress, and what the caller may do here
 * @route   GET /api/projects/:projectId/workspace
 */
const getWorkspace = asyncHandler(async (req, res) => {
  await ensureMilestones(req);
  const [{ project, catalog }, business, milestones, taskCounts] = await Promise.all([
    catalogFor(req.project._id),
    Organization.findById(ownerOrgId(req)).select('name').lean(),
    Milestone.find(inProject(req)).select('status weight dueDate').lean(),
    WorkspaceTask.aggregate([
      { $match: { projectInstanceId: new mongoose.Types.ObjectId(String(req.project._id)) } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
  ]);

  // Who works on it. A business sees every worker; a worker sees its own team.
  const engagementFilter = { projectInstanceId: req.project._id, status: { $in: ['active', 'paused'] } };
  if (req.engagement) engagementFilter._id = req.engagement._id;
  const engagements = await Engagement.find(engagementFilter).lean();
  const partnerOrgs = await Organization.find({ _id: { $in: engagements.map((e) => e.partnerOrgId) } }).select('name profile.verified').lean();
  const memberIds = engagements.flatMap((e) => (e.members || []).map((m) => m.userId));
  const members = await User.find({ _id: { $in: memberIds } }).select('fullName').lean();
  const nameOf = new Map(members.map((u) => [String(u._id), u.fullName]));
  const orgOf = new Map(partnerOrgs.map((o) => [String(o._id), o]));

  const tasks = Object.fromEntries(taskCounts.map((t) => [t._id, t.n]));

  res.json({
    success: true,
    data: {
      viewer: viewerSide(req),
      capabilities: req.engagement ? req.engagement.grants : (req.orgCapabilities || []),
      business: { name: business?.name || '' },
      project: {
        _id: req.project._id,
        slug: project?.projectSlug,
        title: catalog?.title || project?.projectSlug,
        tagline: catalog?.tagline || '',
      },
      brief: catalog ? {
        description: catalog.description || '',
        deliverables: catalog.deliverables || [],
        tools: catalog.tools || [],
        howItWorks: catalog.howItWorks || [],
        kpis: catalog.kpis || [],
        outcomes: catalog.outcomes || [],
        duration: catalog.duration || '',
      } : null,
      workers: engagements.map((e) => ({
        engagementId: e._id,
        name: orgOf.get(String(e.partnerOrgId))?.name || e.invitedEmail,
        verified: !!orgOf.get(String(e.partnerOrgId))?.profile?.verified,
        status: e.status,
        people: (e.members || []).map((m) => nameOf.get(String(m.userId))).filter(Boolean),
      })),
      progress: {
        ...progressOf(milestones),
        tasks: { todo: tasks.todo || 0, doing: tasks.doing || 0, done: tasks.done || 0 },
      },
    },
  });
});

// ── Timeline (milestones) ────────────────────────────────────────────────────

const shapeMilestone = (m) => ({
  _id: m._id,
  order: m.order,
  title: m.title,
  description: m.description,
  dueDate: m.dueDate,
  weight: m.weight,
  status: m.status,
  deliverables: m.deliverables || [],
  completedAt: m.completedAt || null,
  updatedAt: m.updatedAt,
});

async function namesFor(ids) {
  const users = await User.find({ _id: { $in: ids.filter(Boolean) } }).select('fullName').lean();
  return new Map(users.map((u) => [String(u._id), u.fullName]));
}

/**
 * @route   GET /api/projects/:projectId/milestones
 */
const listMilestones = asyncHandler(async (req, res) => {
  need(req, 'plan.view');
  await ensureMilestones(req);
  const milestones = await Milestone.find(inProject(req)).sort({ order: 1, createdAt: 1 }).lean();
  res.json({
    success: true,
    data: { milestones: milestones.map(shapeMilestone), progress: progressOf(milestones), canEdit: hasCapability(req, 'plan.edit') },
  });
});

function cleanDeliverables(list) {
  if (!Array.isArray(list)) throw new AppError('Deliverables must be a list', 400);
  return list.slice(0, 30).map((d) => ({
    name: String(d?.name || '').trim().slice(0, 200),
    link: String(d?.link || '').trim().slice(0, 500),
    done: !!d?.done,
  })).filter((d) => d.name);
}

/**
 * @desc    Add a milestone to the plan (the worker, or a self-serve business)
 * @route   POST /api/projects/:projectId/milestones
 */
const createMilestone = asyncHandler(async (req, res, next) => {
  need(req, 'plan.edit', 'Only the people doing the work can change the plan');
  const title = String(req.body.title || '').trim();
  if (title.length < 2) return next(new AppError('Give the milestone a title', 400));
  const last = await Milestone.findOne(inProject(req)).sort({ order: -1 }).select('order').lean();
  const milestone = await Milestone.create({
    organizationId: ownerOrgId(req),
    projectInstanceId: req.project._id,
    order: (last?.order ?? -1) + 1,
    title: title.slice(0, 140),
    description: String(req.body.description || '').trim().slice(0, 2000),
    dueDate: req.body.dueDate !== undefined ? cleanDate(req.body.dueDate) : null,
    deliverables: req.body.deliverables ? cleanDeliverables(req.body.deliverables) : [],
    createdBy: req.user._id,
  });
  await audit(req, 'milestone.created', {
    target: { type: 'Milestone', id: milestone._id },
    summary: `${req.user.fullName} added the milestone "${milestone.title}"`,
  });
  res.status(201).json({ success: true, data: { milestone: shapeMilestone(milestone.toObject()) } });
});

/**
 * @desc    Change a milestone — the people doing the work plan and track it
 *          freely (title, description, due date, deliverables, status
 *          not_started / in_progress / done). No approval from the client.
 * @route   PATCH /api/projects/:projectId/milestones/:milestoneId
 */
const updateMilestone = asyncHandler(async (req, res, next) => {
  need(req, 'plan.edit', 'Only the people doing the work can change the plan');
  if (!isId(req.params.milestoneId)) return next(new AppError('Not found', 404));
  const milestone = await Milestone.findOne({ _id: req.params.milestoneId, ...inProject(req) });
  if (!milestone) return next(new AppError('Not found', 404));

  const before = milestone.status;
  const { status } = req.body;
  if (status !== undefined) {
    if (!Milestone.STATUSES.includes(status)) return next(new AppError('Unknown status', 400));
    milestone.status = status;
    milestone.completedAt = status === 'done' ? (milestone.completedAt || new Date()) : undefined;
  }
  if (req.body.title !== undefined) {
    const t = String(req.body.title).trim();
    if (t.length < 2) return next(new AppError('Give the milestone a title', 400));
    milestone.title = t.slice(0, 140);
  }
  if (req.body.description !== undefined) milestone.description = String(req.body.description).trim().slice(0, 2000);
  if (req.body.dueDate !== undefined) milestone.dueDate = cleanDate(req.body.dueDate);
  if (req.body.deliverables !== undefined) milestone.deliverables = cleanDeliverables(req.body.deliverables);
  if (req.body.weight !== undefined) milestone.weight = Math.max(0, Math.min(100, Number(req.body.weight) || 1));
  milestone.updatedBy = req.user._id;
  await milestone.save();

  // The client follows these updates (Activity and its dashboard)
  const action = before !== 'done' && milestone.status === 'done' ? 'milestone.completed'
    : before === 'not_started' && milestone.status === 'in_progress' ? 'milestone.started'
      : 'milestone.updated';
  const verb = { 'milestone.completed': 'completed', 'milestone.started': 'started', 'milestone.updated': 'updated' }[action];
  await audit(req, action, {
    target: { type: 'Milestone', id: milestone._id },
    summary: `${req.user.fullName} ${verb} the milestone "${milestone.title}"`,
  });

  res.json({ success: true, data: { milestone: shapeMilestone(milestone.toObject()) } });
});

// ── Tasks ────────────────────────────────────────────────────────────────────

/** People who can be given a task: the worker's team on this project (or the business's team). */
async function assignablePeople(req) {
  if (req.engagement) {
    const e = await Engagement.findById(req.engagement._id).select('members').lean();
    return (e?.members || []).map((m) => String(m.userId));
  }
  const ms = await Membership.find({ organizationId: req.organizationId, status: 'active' }).select('userId').lean();
  return ms.map((m) => String(m.userId));
}

const shapeTask = (t, names) => ({
  _id: t._id,
  title: t.title,
  notes: t.notes,
  status: t.status,
  milestoneId: t.milestoneId,
  dueDate: t.dueDate,
  assigneeId: t.assigneeId,
  assignee: t.assigneeId ? names.get(String(t.assigneeId)) || null : null,
  completedAt: t.completedAt || null,
});

/**
 * @route   GET /api/projects/:projectId/tasks
 */
const listTasks = asyncHandler(async (req, res) => {
  // Tasks are the worker's team's own to-do list
  need(req, 'plan.edit', 'Tasks belong to the team doing the work');
  const tasks = await WorkspaceTask.find(inProject(req)).sort({ status: 1, dueDate: 1, createdAt: 1 }).lean();
  const people = await assignablePeople(req);
  const names = await namesFor([...tasks.map((t) => t.assigneeId), ...people]);
  res.json({
    success: true,
    data: {
      tasks: tasks.map((t) => shapeTask(t, names)),
      people: people.map((id) => ({ userId: id, fullName: names.get(id) || '' })),
      canEdit: hasCapability(req, 'plan.edit'),
    },
  });
});

async function checkAssignee(req, assigneeId) {
  if (assigneeId === null || assigneeId === '' || assigneeId === undefined) return null;
  if (!isId(assigneeId) || !(await assignablePeople(req)).includes(String(assigneeId))) {
    throw new AppError('Tasks can only go to people on this project', 400);
  }
  return assigneeId;
}

async function checkMilestone(req, milestoneId) {
  if (!milestoneId) return null;
  if (!isId(milestoneId) || !(await Milestone.exists({ _id: milestoneId, ...inProject(req) }))) {
    throw new AppError('Unknown milestone', 400);
  }
  return milestoneId;
}

/**
 * @route   POST /api/projects/:projectId/tasks
 */
const createTask = asyncHandler(async (req, res, next) => {
  need(req, 'plan.edit', 'Only the people doing the work can add tasks');
  const title = String(req.body.title || '').trim();
  if (title.length < 2) return next(new AppError('Give the task a title', 400));
  const task = await WorkspaceTask.create({
    organizationId: ownerOrgId(req),
    projectInstanceId: req.project._id,
    title: title.slice(0, 200),
    notes: String(req.body.notes || '').trim().slice(0, 2000),
    milestoneId: await checkMilestone(req, req.body.milestoneId),
    assigneeId: await checkAssignee(req, req.body.assigneeId),
    dueDate: req.body.dueDate ? cleanDate(req.body.dueDate) : null,
    createdBy: req.user._id,
  });
  await audit(req, 'task.created', { target: { type: 'WorkspaceTask', id: task._id }, summary: `${req.user.fullName} added the task "${task.title}"` });
  const names = await namesFor([task.assigneeId]);
  res.status(201).json({ success: true, data: { task: shapeTask(task.toObject(), names) } });
});

/**
 * @route   PATCH /api/projects/:projectId/tasks/:taskId
 */
const updateTask = asyncHandler(async (req, res, next) => {
  need(req, 'plan.edit', 'Only the people doing the work can change tasks');
  if (!isId(req.params.taskId)) return next(new AppError('Not found', 404));
  const task = await WorkspaceTask.findOne({ _id: req.params.taskId, ...inProject(req) });
  if (!task) return next(new AppError('Not found', 404));

  const before = task.status;
  if (req.body.title !== undefined) {
    const t = String(req.body.title).trim();
    if (t.length < 2) return next(new AppError('Give the task a title', 400));
    task.title = t.slice(0, 200);
  }
  if (req.body.notes !== undefined) task.notes = String(req.body.notes).trim().slice(0, 2000);
  if (req.body.status !== undefined) {
    if (!WorkspaceTask.STATUSES.includes(req.body.status)) return next(new AppError('Unknown status', 400));
    task.status = req.body.status;
    task.completedAt = req.body.status === 'done' ? new Date() : undefined;
  }
  if (req.body.assigneeId !== undefined) task.assigneeId = await checkAssignee(req, req.body.assigneeId);
  if (req.body.milestoneId !== undefined) task.milestoneId = await checkMilestone(req, req.body.milestoneId);
  if (req.body.dueDate !== undefined) task.dueDate = req.body.dueDate ? cleanDate(req.body.dueDate) : null;
  await task.save();

  if (before !== 'done' && task.status === 'done') {
    await audit(req, 'task.completed', { target: { type: 'WorkspaceTask', id: task._id }, summary: `${req.user.fullName} completed "${task.title}"` });
  }
  const names = await namesFor([task.assigneeId]);
  res.json({ success: true, data: { task: shapeTask(task.toObject(), names) } });
});

/**
 * @route   DELETE /api/projects/:projectId/tasks/:taskId
 */
const deleteTask = asyncHandler(async (req, res, next) => {
  need(req, 'plan.edit', 'Only the people doing the work can remove tasks');
  if (!isId(req.params.taskId)) return next(new AppError('Not found', 404));
  const task = await WorkspaceTask.findOneAndDelete({ _id: req.params.taskId, ...inProject(req) });
  if (!task) return next(new AppError('Not found', 404));
  res.json({ success: true });
});

// ── Activity ─────────────────────────────────────────────────────────────────

/**
 * @route   GET /api/projects/:projectId/activity
 */
const listActivity = asyncHandler(async (req, res) => {
  const events = await AuditEvent.find({ projectInstanceId: req.project._id })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  const orgs = await Organization.find({ _id: { $in: [...new Set(events.map((e) => String(e.actorOrgId)).filter(Boolean))] } }).select('name type').lean();
  const orgOf = new Map(orgs.map((o) => [String(o._id), o]));
  res.json({
    success: true,
    data: {
      events: events.map((e) => ({
        _id: e._id,
        action: e.action,
        summary: e.summary,
        via: e.via,
        org: orgOf.get(String(e.actorOrgId))?.name || null,
        at: e.createdAt,
      })),
    },
  });
});

module.exports = {
  getWorkspace,
  listMilestones,
  createMilestone,
  updateMilestone,
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  listActivity,
};
