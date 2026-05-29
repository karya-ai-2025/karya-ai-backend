// controllers/contentProjectAdminController.js
// Admin-facing: list projects, generate content (SSE), edit, assign, deliver

const jwt       = require('jsonwebtoken');
const Anthropic  = require('@anthropic-ai/sdk');
const ContentProject = require('../models/ContentProject');
const User       = require('../models/User');
const { config } = require('../config/config');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

// Lazy init — reads env var at request time, not at module load
function getAnthropic() {
  return new Anthropic({ apiKey: config.anthropicApiKey });
}

// ── GET /api/admin/content-projects — list all projects ─────────────────────
const getAllProjects = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (status) filter.status = status;

  const skip = (Number(page) - 1) * Number(limit);
  const [projects, total] = await Promise.all([
    ContentProject.find(filter)
      .populate('userId', 'fullName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    ContentProject.countDocuments(filter),
  ]);

  res.json({ status: 'success', data: { projects, total, page: Number(page) } });
});

// ── GET /api/admin/content-projects/:id — single project detail ──────────────
const getProjectDetail = asyncHandler(async (req, res, next) => {
  const project = await ContentProject.findById(req.params.id)
    .populate('userId', 'fullName email')
    .populate('assignedTo', 'fullName email');
  if (!project) return next(new AppError('Project not found', 404));
  res.json({ status: 'success', data: { project } });
});

// ── GET /api/admin/content-projects/:id/generate — SSE streaming ────────────
// EventSource can't send headers, so we verify the JWT from ?_token=<jwt>.
const generateContent = async (req, res, next) => {
  // Auth: read token from query param (EventSource limitation)
  const rawToken = req.query._token;
  if (!rawToken) return res.status(401).json({ message: 'No token provided' });
  try {
    const decoded = jwt.verify(rawToken, config.jwt.secret);
    const user    = await User.findById(decoded.id);
    if (!user || !user.isActive || (!user.isAdmin && user.activeRole !== 'admin')) {
      return res.status(403).json({ message: 'Admin access required' });
    }
    req.user = user;
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }

  let project;
  try {
    project = await ContentProject.findById(req.params.id);
    if (!project) return next(new AppError('Project not found', 404));
    if (!project.intake?.submittedAt) {
      return next(new AppError('Intake form not submitted yet', 400));
    }
  } catch (err) {
    return next(err);
  }

  // ── SSE headers ─────────────────────────────────────────────────────────
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Mark as generating
  project.status = 'generating';
  await project.save();
  send('status', { status: 'generating' });

  const { intake } = project;

  // Include the latest revision feedback in the prompt when re-generating
  const latestRevision = project.approvalHistory
    ?.filter(h => h.action === 'revision_requested')
    .sort((a, b) => new Date(b.performedAt || 0) - new Date(a.performedAt || 0))[0];

  const prompt = buildPrompt(intake, latestRevision?.note || null);

  let fullText = '';

  try {
    const stream = getAnthropic().messages.stream({
      model:      'claude-opus-4-7',
      max_tokens: 4096,
      messages:   [{ role: 'user', content: prompt }],
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        const token = chunk.delta.text;
        fullText += token;
        send('token', { token });
      }
    }

    // Parse the structured JSON block from Claude's output
    const parsed = extractJSON(fullText);
    const overwrite = req.query.overwrite === 'true';

    let versionNumber;
    if (overwrite && project.contentVersions.length > 0) {
      // Overwrite the last version in-place (admin re-generated before sending to client)
      const lastIdx = project.contentVersions.length - 1;
      versionNumber = project.contentVersions[lastIdx].versionNumber;
      project.contentVersions.splice(lastIdx, 1);
      project.contentVersions.push({
        versionNumber,
        generatedBy:   'claude-opus-4-7',
        generatedAt:   new Date(),
        linkedinPosts: parsed.linkedinPosts || [],
        newsletter:    parsed.newsletter    || {},
        adminNotes:    '',
      });
    } else {
      versionNumber = (project.contentVersions.length || 0) + 1;
      project.contentVersions.push({
        versionNumber,
        generatedBy:   'claude-opus-4-7',
        generatedAt:   new Date(),
        linkedinPosts: parsed.linkedinPosts || [],
        newsletter:    parsed.newsletter    || {},
        adminNotes:    '',
      });
    }

    project.status = 'admin_review';
    await project.save();

    send('done', { status: 'admin_review', versionNumber });
    res.end();
  } catch (err) {
    project.status = 'in_review'; // revert so admin can retry
    await project.save().catch(() => {});
    send('error', { message: err.message || 'Generation failed' });
    res.end();
  }
};

// ── PUT /api/admin/content-projects/:id/version/:versionNumber — edit draft ──
const updateVersion = asyncHandler(async (req, res, next) => {
  const project = await ContentProject.findById(req.params.id);
  if (!project) return next(new AppError('Project not found', 404));

  const version = project.contentVersions.find(
    v => v.versionNumber === Number(req.params.versionNumber),
  );
  if (!version) return next(new AppError('Version not found', 404));

  const { linkedinPosts, newsletter, adminNotes } = req.body;
  if (linkedinPosts) version.linkedinPosts = linkedinPosts;
  if (newsletter)    version.newsletter    = newsletter;
  if (adminNotes !== undefined) version.adminNotes = adminNotes;

  await project.save();
  res.json({ status: 'success', data: { version } });
});

// ── PUT /api/admin/content-projects/:id/admin-notes — save notes ─────────────
const saveAdminNotes = asyncHandler(async (req, res, next) => {
  const project = await ContentProject.findByIdAndUpdate(
    req.params.id,
    { adminNotes: req.body.adminNotes || '' },
    { new: true },
  );
  if (!project) return next(new AppError('Project not found', 404));
  res.json({ status: 'success', data: { adminNotes: project.adminNotes } });
});

// ── PUT /api/admin/content-projects/:id/assign — assign to team member ───────
const assignProject = asyncHandler(async (req, res, next) => {
  const project = await ContentProject.findByIdAndUpdate(
    req.params.id,
    { assignedTo: req.body.assignedTo || null },
    { new: true },
  );
  if (!project) return next(new AppError('Project not found', 404));
  res.json({ status: 'success', data: { assignedTo: project.assignedTo } });
});

// ── POST /api/admin/content-projects/:id/deliver — mark as delivered ─────────
const deliverProject = asyncHandler(async (req, res, next) => {
  const project = await ContentProject.findById(req.params.id);
  if (!project) return next(new AppError('Project not found', 404));
  if (project.status !== 'approved') {
    return next(new AppError('Client must approve the content before it can be delivered', 400));
  }

  project.status      = 'delivered';
  project.deliveredAt = new Date();
  project.approvalHistory.push({
    action:      'delivered',
    performedBy: req.user._id,
    note:        req.body.note || 'Marked as delivered by admin',
  });

  await project.save();
  res.json({ status: 'success', data: { project } });
});

// ── helpers ───────────────────────────────────────────────────────────────────

function buildPrompt(intake, revisionNote = null) {
  const topics = intake.keyTopics?.length
    ? intake.keyTopics.join(', ')
    : 'business growth, thought leadership, industry trends';

  let prompt = `You are a world-class B2B content strategist creating a month's worth of LinkedIn + newsletter content.

CLIENT BRIEF:
- Company: ${intake.companyName}
- Industry: ${intake.industry}
- Target Audience: ${intake.targetAudience}
- Brand Voice: ${intake.brandVoice}
- Key Topics: ${topics}
- Competitors: ${intake.competitors || 'Not specified'}
- Goals: ${intake.goals || 'Build thought leadership and generate leads'}
- Additional Notes: ${intake.additionalNotes || 'None'}`;

  if (revisionNote) {
    prompt += `\n\nIMPORTANT — REVISION REQUEST: A previous draft was rejected by the client. Their specific feedback:\n"${revisionNote}"\n\nYou MUST directly address this feedback. Create meaningfully different content that fixes the issues the client described. Do not repeat the same approaches.`;
  }

  prompt += `\n\nCreate a full month's content package. Respond ONLY with a valid JSON object — no markdown, no explanation, just raw JSON.

JSON structure:
{
  "linkedinPosts": [
    {
      "weekNumber": 1,
      "hookLine": "...",
      "body": "...",
      "cta": "...",
      "hashtags": ["hashtag1", "hashtag2", "hashtag3"],
      "characterCount": 0
    },
    { "weekNumber": 2, ... },
    { "weekNumber": 3, ... },
    { "weekNumber": 4, ... }
  ],
  "newsletter": {
    "subjectLine": "...",
    "previewText": "...",
    "body": "...",
    "wordCount": 0
  }
}

Guidelines:
- LinkedIn posts: 150-300 characters each, punchy hook, 3-5 hashtags, clear CTA
- Newsletter: 400-600 words, storytelling structure, actionable insights
- Match the brand voice: ${intake.brandVoice}
- Tailor every piece to the target audience: ${intake.targetAudience}
- Vary topics across 4 weeks so each post feels fresh
- Fill in characterCount and wordCount accurately`;

  return prompt;
}

function extractJSON(text) {
  try {
    // Claude may wrap JSON in a code block
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = match ? match[1] : text;
    return JSON.parse(jsonStr.trim());
  } catch {
    // Return empty structure so the version still saves — admin can edit manually
    return { linkedinPosts: [], newsletter: {} };
  }
}

// ── POST /api/content-projects/admin/:id/send-to-client ──────────────────────
const sendToClient = asyncHandler(async (req, res, next) => {
  const project = await ContentProject.findById(req.params.id);
  if (!project) return next(new AppError('Project not found', 404));
  if (project.status !== 'admin_review') {
    return next(new AppError('Content must be in admin review state before sending to client', 400));
  }

  project.status = 'draft_ready';
  await project.save();
  res.json({ status: 'success', data: { project } });
});

// ── Background generation (called from submitIntake, no SSE) ─────────────────
async function generateProjectInBackground(projectId) {
  let project;
  try {
    project = await ContentProject.findById(projectId);
    if (!project || !project.intake?.submittedAt) return;

    const prompt = buildPrompt(project.intake, null);
    const message = await getAnthropic().messages.create({
      model:      'claude-opus-4-7',
      max_tokens: 4096,
      messages:   [{ role: 'user', content: prompt }],
    });

    const fullText = message.content[0]?.text || '';
    const parsed   = extractJSON(fullText);
    const versionNumber = (project.contentVersions.length || 0) + 1;

    project.contentVersions.push({
      versionNumber,
      generatedBy:   'claude-opus-4-7',
      generatedAt:   new Date(),
      linkedinPosts: parsed.linkedinPosts || [],
      newsletter:    parsed.newsletter    || {},
      adminNotes:    '',
    });
    project.status = 'admin_review';
    await project.save();
  } catch (err) {
    console.error('[bg-generation] failed:', err.message);
    try {
      if (!project) project = await ContentProject.findById(projectId);
      if (project && project.status === 'generating') {
        project.status = 'in_review';
        await project.save();
      }
    } catch {}
  }
}

module.exports = {
  getAllProjects,
  getProjectDetail,
  generateContent,
  updateVersion,
  saveAdminNotes,
  assignProject,
  deliverProject,
  sendToClient,
  generateProjectInBackground,
};
