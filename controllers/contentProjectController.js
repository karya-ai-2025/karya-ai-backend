// controllers/contentProjectController.js
// User-facing: find/create project, submit intake, view draft, approve/reject

const ContentProject = require('../models/ContentProject');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

// ── GET /api/content-projects/my — list all campaigns for this user ──────────
const getMyProjects = asyncHandler(async (req, res) => {
  const projects = await ContentProject.find({ userId: req.user._id })
    .sort({ createdAt: -1 })
    .lean();
  res.json({ status: 'success', data: { projects } });
});

// ── POST /api/content-projects — create a new campaign ───────────────────────
const createProject = asyncHandler(async (req, res) => {
  const project = await ContentProject.create({
    userId:    req.user._id,
    catalogId: req.body.catalogId || null,
    month:     currentMonth(),
  });
  res.status(201).json({ status: 'success', data: { project } });
});

// ── POST /api/content-projects/:id/intake — submit intake form ───────────────
const submitIntake = asyncHandler(async (req, res, next) => {
  const project = await ContentProject.findOne({
    _id:    req.params.id,
    userId: req.user._id,
  });
  if (!project) return next(new AppError('Project not found', 404));

  if (!['intake_pending', 'revision_requested'].includes(project.status)) {
    return next(new AppError('Intake already submitted', 400));
  }

  const {
    companyName, industry, targetAudience, brandVoice,
    keyTopics, competitors, goals, additionalNotes,
  } = req.body;

  if (!companyName || !industry || !targetAudience || !brandVoice) {
    return next(new AppError('companyName, industry, targetAudience, brandVoice are required', 400));
  }

  project.intake = {
    companyName,
    industry,
    targetAudience,
    brandVoice,
    keyTopics:       Array.isArray(keyTopics) ? keyTopics : [],
    competitors:     competitors || '',
    goals:           goals || '',
    additionalNotes: additionalNotes || '',
    submittedAt:     new Date(),
  };
  project.status = 'generating';

  await project.save();
  res.json({ status: 'success', data: { project } });

  // Fire-and-forget background generation — response already sent
  const { generateProjectInBackground } = require('./contentProjectAdminController');
  generateProjectInBackground(project._id).catch(() => {});
});

// ── GET /api/content-projects/:id/preview — see latest draft ─────────────────
const getPreview = asyncHandler(async (req, res, next) => {
  const project = await ContentProject.findOne({
    _id:    req.params.id,
    userId: req.user._id,
  });
  if (!project) return next(new AppError('Project not found', 404));

  if (!['admin_review', 'draft_ready', 'revision_requested', 'approved', 'delivered'].includes(project.status)) {
    return next(new AppError('Content not ready yet', 400));
  }

  res.json({
    status: 'success',
    data: {
      status:        project.status,
      latestVersion: project.latestVersion,
    },
  });
});

// ── POST /api/content-projects/:id/approve — user approves draft ──────────────
const approveContent = asyncHandler(async (req, res, next) => {
  const project = await ContentProject.findOne({
    _id:    req.params.id,
    userId: req.user._id,
  });
  if (!project) return next(new AppError('Project not found', 404));
  if (project.status !== 'draft_ready') {
    return next(new AppError('No draft available to approve', 400));
  }

  const latestVersion = project.contentVersions[project.contentVersions.length - 1];
  if (latestVersion) {
    latestVersion.isApproved = true;
    latestVersion.approvedAt = new Date();
    latestVersion.approvedBy = req.user._id;
  }

  project.status = 'approved';
  project.approvalHistory.push({
    action:        'approved',
    performedBy:   req.user._id,
    versionNumber: latestVersion?.versionNumber,
    note:          req.body.note || '',
  });

  await project.save();
  res.json({ status: 'success', data: { project } });
});

// ── POST /api/content-projects/:id/reject — user requests revision ───────────
const rejectContent = asyncHandler(async (req, res, next) => {
  const project = await ContentProject.findOne({
    _id:    req.params.id,
    userId: req.user._id,
  });
  if (!project) return next(new AppError('Project not found', 404));
  if (project.status !== 'draft_ready') {
    return next(new AppError('No draft available to reject', 400));
  }

  if (!req.body.note) {
    return next(new AppError('Revision note is required', 400));
  }

  project.status = 'revision_requested';
  const latestVersion = project.contentVersions[project.contentVersions.length - 1];
  project.approvalHistory.push({
    action:        'revision_requested',
    performedBy:   req.user._id,
    versionNumber: latestVersion?.versionNumber,
    note:          req.body.note,
  });

  await project.save();
  res.json({ status: 'success', data: { project } });
});

// ── helpers ───────────────────────────────────────────────────────────────────
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

module.exports = { getMyProjects, createProject, submitIntake, getPreview, approveContent, rejectContent };
