// controllers/hitlController.js
// Human-in-the-loop approval requests + AI email drafting for the assistant.

const HitlRequest = require('../models/HitlRequest');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const Anthropic = require('@anthropic-ai/sdk');

function getAnthropic() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// POST /api/hitl — create an approval request
const createHitlRequest = asyncHandler(async (req, res, next) => {
  const { projectSlug = '', type = 'email_approval', title, payload = {}, context = {} } = req.body;

  if (!title || !title.trim()) {
    return next(new AppError('A title is required', 400));
  }

  const request = await HitlRequest.create({
    userId: req.user._id,
    projectSlug,
    type,
    title: title.trim(),
    payload,
    context
  });

  res.status(201).json({ success: true, data: request });
});

// GET /api/hitl?status=pending — list the current user's requests + pending count
const getHitlRequests = asyncHandler(async (req, res) => {
  const filter = { userId: req.user._id };
  if (req.query.status) filter.status = req.query.status;

  const [requests, pendingCount] = await Promise.all([
    HitlRequest.find(filter).sort({ createdAt: -1 }).limit(100),
    HitlRequest.countDocuments({ userId: req.user._id, status: 'pending' })
  ]);

  res.json({ success: true, data: requests, pendingCount });
});

// GET /api/hitl/:id
const getHitlRequest = asyncHandler(async (req, res, next) => {
  const request = await HitlRequest.findOne({ _id: req.params.id, userId: req.user._id });
  if (!request) return next(new AppError('Approval request not found', 404));
  res.json({ success: true, data: request });
});

// PATCH /api/hitl/:id/status — user actions: approve / request changes (→ expert) / reject
const updateHitlStatus = asyncHandler(async (req, res, next) => {
  const { status, note = '' } = req.body;
  const allowed = ['approved', 'with_expert', 'rejected', 'revision_requested', 'pending'];
  if (!allowed.includes(status)) {
    return next(new AppError('Invalid status', 400));
  }

  const request = await HitlRequest.findOne({ _id: req.params.id, userId: req.user._id });
  if (!request) return next(new AppError('Approval request not found', 404));

  request.status = status;
  request.reviewerNote = note;
  request.reviewedAt = new Date();
  // Sending it back to the expert counts as another revision round-trip.
  if (status === 'with_expert') request.revisionCount += 1;
  await request.save();

  res.json({ success: true, data: request });
});

// ── Admin (expert) endpoints ──────────────────────────────────────────────────

// GET /api/hitl/admin/list?status=with_expert — all users' requests (admin only)
const adminListRequests = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  const requests = await HitlRequest.find(filter)
    .sort({ createdAt: -1 })
    .limit(200)
    .populate('userId', 'fullName email');

  res.json({ success: true, data: requests });
});

// PATCH /api/hitl/admin/:id — expert edits the draft and/or sends it to the user
const adminUpdateRequest = asyncHandler(async (req, res, next) => {
  const { subject, body, status, expertNote } = req.body;

  const request = await HitlRequest.findById(req.params.id);
  if (!request) return next(new AppError('Approval request not found', 404));

  if (typeof subject === 'string') request.payload.subject = subject;
  if (typeof body === 'string') request.payload.body = body;
  if (typeof expertNote === 'string') request.expertNote = expertNote;
  if (status && ['with_expert', 'awaiting_user'].includes(status)) {
    request.status = status;
    if (status === 'awaiting_user') request.reviewedAt = new Date();
  }

  await request.save();
  res.json({ success: true, data: request });
});

// POST /api/hitl/admin/:id/regenerate — expert regenerates the body via Claude from context
const regenerateRequest = asyncHandler(async (req, res, next) => {
  const request = await HitlRequest.findById(req.params.id);
  if (!request) return next(new AppError('Approval request not found', 404));

  const ctx = request.context || {};
  const guidance = req.body?.guidance || request.reviewerNote || '';

  if (!process.env.ANTHROPIC_API_KEY) {
    const subject = `A quick idea for ${ctx.audience || 'your team'}`;
    const body =
      `Hi {{firstName}},\n\n` +
      `Following up from ${ctx.company || 'our team'} — we help ${ctx.audience || 'teams like yours'} ` +
      `${ctx.product ? `with ${ctx.product}` : 'move faster on what matters'}.\n\n` +
      `${ctx.cta || 'Open to a quick 15-minute chat next week?'}\n\n` +
      `Best,\n{{senderName}}`;
    request.payload.subject = subject;
    request.payload.body = body;
    await request.save();
    return res.json({ success: true, data: request, generated: 'template' });
  }

  const prompt = `Rewrite this B2B cold outbound email, improving it as an expert reviewer.
Tone/voice: ${ctx.tone || 'friendly, professional'}
From company: ${ctx.company || 'our company'}
Target audience: ${ctx.audience || 'business decision-makers'}
Product/offer: ${ctx.product || 'our solution'}
Call to action: ${ctx.cta || 'book a short call'}
${guidance ? `Reviewer/user guidance: ${guidance}` : ''}

Current subject: ${request.payload.subject || ''}
Current body: ${request.payload.body || ''}

Rules: 90-130 words, no fluff, one clear CTA. Use {{firstName}} and {{senderName}} merge tags.
Return ONLY valid JSON, no markdown: {"subject":"...","body":"..."}`;

  const message = await getAnthropic().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 700,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = message.content[0]?.text?.trim() || '';
  let parsed;
  try {
    const cleaned = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return next(new AppError('AI returned an unexpected format. Please try again.', 500));
  }

  request.payload.subject = parsed.subject || request.payload.subject;
  request.payload.body = parsed.body || request.payload.body;
  await request.save();

  res.json({ success: true, data: request, generated: 'ai' });
});

// POST /api/agent/draft-email — generate an outbound email draft for the assistant
const draftEmail = asyncHandler(async (req, res, next) => {
  const { tone = '', audience = '', company = '', product = '', cta = '', extra = '' } = req.body;

  // Graceful fallback when no API key is configured — return a templated draft so
  // the feature still works end-to-end in local/dev environments.
  if (!process.env.ANTHROPIC_API_KEY) {
    const subject = `A quick idea for ${audience || 'your team'}`;
    const body =
      `Hi {{firstName}},\n\n` +
      `I'm reaching out from ${company || 'our team'} — we help ${audience || 'teams like yours'} ` +
      `${product ? `with ${product}` : 'move faster on what matters'}.\n\n` +
      `${cta || 'Open to a quick 15-minute chat next week?'}\n\n` +
      `Best,\n{{senderName}}`;
    return res.json({ success: true, data: { subject, body }, generated: 'template' });
  }

  const prompt = `Write a concise B2B cold outbound email.
Tone/voice: ${tone || 'friendly, professional'}
From company: ${company || 'our company'}
Target audience: ${audience || 'business decision-makers'}
Product/offer: ${product || 'our solution'}
Call to action: ${cta || 'book a short call'}
${extra ? `Revision request from the user: ${extra}` : ''}

Rules: 90-130 words, no fluff, one clear CTA, no subject-line clickbait. Use {{firstName}} and {{senderName}} as merge tags.
Return ONLY valid JSON, no markdown: {"subject":"...","body":"..."}`;

  const message = await getAnthropic().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 700,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = message.content[0]?.text?.trim() || '';
  let parsed;
  try {
    const cleaned = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return next(new AppError('AI returned an unexpected format. Please try again.', 500));
  }

  res.json({
    success: true,
    data: { subject: parsed.subject || '', body: parsed.body || '' },
    generated: 'ai'
  });
});

module.exports = {
  createHitlRequest,
  getHitlRequests,
  getHitlRequest,
  updateHitlStatus,
  draftEmail,
  adminListRequests,
  adminUpdateRequest,
  regenerateRequest
};
