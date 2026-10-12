// controllers/expertInterviewController.js
// Voice interview an expert takes with the ElevenLabs agent after onboarding.
//
// Flow:
//   1. POST /api/expert-interview/session      → we build a brief from the
//      expert's profile and hand the browser a short-lived conversation token
//      plus the prompt / first message to start the agent with.
//   2. POST /api/expert-interview/:id/started  → the browser reports the
//      ElevenLabs conversation id once the call connects.
//   3. POST /api/expert-interview/:id/ended    → the call is over; we pull the
//      transcript from ElevenLabs (it takes a few seconds to be ready), store
//      it, and extract structured knowledge with Claude.
//   GET  /api/expert-interview/status re-checks any interview still waiting on
//   its transcript, so a closed tab doesn't lose the call.

const User = require('../models/User');
const ExpertProfile = require('../models/ExpertProfile');
const ExpertInterview = require('../models/ExpertInterview');
const { config } = require('../config/config');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const elevenLabs = require('../services/elevenLabsService');
const { buildInterviewBrief } = require('../services/expertInterviewPrompt');
const { extractExpertKnowledge } = require('../utils/extractExpertKnowledge');

const MAX_SESSIONS_PER_DAY = 5;
const MAX_FETCH_ATTEMPTS = 12;
const FETCH_INTERVAL_MS = 10 * 1000;
// A call left "in progress" this long has ended without the browser telling us
const STALE_CALL_MS = 45 * 60 * 1000;

const publicView = (interview) => interview && {
  id: interview._id,
  status: interview.status,
  startedAt: interview.startedAt,
  completedAt: interview.completedAt,
  durationSecs: interview.durationSecs
};

const stitch = (entries, expertName) =>
  entries.map((e) => `${e.role === 'agent' ? 'Agent' : expertName || 'Expert'}: ${e.message}`).join('\n');

/**
 * Pull the conversation from ElevenLabs and, once it has finished processing,
 * store the transcript. Returns the interview's status afterwards.
 * Safe to call repeatedly.
 */
const syncInterview = async (interviewId) => {
  const interview = await ExpertInterview.findById(interviewId);
  if (!interview || !interview.conversationId) return interview?.status;
  if (['completed', 'failed', 'abandoned'].includes(interview.status)) return interview.status;

  interview.fetchAttempts += 1;

  let conversation;
  try {
    conversation = await elevenLabs.getConversation(interview.conversationId);
  } catch (err) {
    interview.fetchError = err.message;
    await interview.save();
    return interview.status;
  }

  // The id comes from the browser — only accept conversations held with our agent
  if (conversation.agent_id && conversation.agent_id !== interview.agentId) {
    interview.status = 'failed';
    interview.fetchError = 'Conversation does not belong to the interview agent';
    await interview.save();
    return interview.status;
  }

  if (conversation.status === 'failed') {
    interview.status = 'failed';
    interview.fetchError = 'ElevenLabs reported the conversation as failed';
    await interview.save();
    return interview.status;
  }

  // initiated / in-progress / processing — not ready yet
  if (conversation.status !== 'done') {
    await interview.save();
    return interview.status;
  }

  const entries = (conversation.transcript || [])
    .filter((t) => t.message && String(t.message).trim())
    .map((t) => ({
      role: t.role === 'agent' ? 'agent' : 'user',
      message: String(t.message).trim(),
      timeInCallSecs: t.time_in_call_secs
    }));
  const expertSpoke = entries.some((e) => e.role === 'user');

  const user = await User.findById(interview.userId).select('fullName');
  interview.entries = entries;
  interview.rawTranscript = stitch(entries, user?.fullName);
  interview.summary = conversation.analysis?.transcript_summary || null;
  interview.durationSecs = conversation.metadata?.call_duration_secs ?? null;
  interview.endedAt = interview.endedAt || new Date();
  interview.fetchError = null;
  interview.status = expertSpoke ? 'completed' : 'abandoned';
  if (expertSpoke) interview.completedAt = new Date();
  await interview.save();

  if (expertSpoke) {
    try {
      const { extractedData } = await extractExpertKnowledge({
        rawTranscript: interview.rawTranscript,
        profileSnapshot: interview.profileSnapshot
      });
      await ExpertInterview.updateOne({ _id: interview._id }, { extractedData, extractError: null });
    } catch (err) {
      // The transcript is what matters; extraction can be re-run from it
      console.error(`[ExpertInterview] extraction failed for ${interview._id}:`, err.message);
      await ExpertInterview.updateOne({ _id: interview._id }, { extractError: err.message });
    }
  }

  return interview.status;
};

// ElevenLabs needs a few seconds after hang-up before the transcript is ready
const pollUntilReady = (interviewId, attempt = 1) => {
  setTimeout(async () => {
    try {
      const status = await syncInterview(interviewId);
      if (status !== 'processing') return;
      if (attempt >= MAX_FETCH_ATTEMPTS) {
        await ExpertInterview.updateOne(
          { _id: interviewId, status: 'processing' },
          { status: 'failed', fetchError: 'Transcript was not ready in time' }
        );
        return;
      }
      pollUntilReady(interviewId, attempt + 1);
    } catch (err) {
      console.error(`[ExpertInterview] sync failed for ${interviewId}:`, err.message);
    }
  }, FETCH_INTERVAL_MS).unref();
};

const findOwn = async (req) => {
  const interview = await ExpertInterview.findOne({ _id: req.params.id, userId: req.user._id });
  if (!interview) throw new AppError('Interview not found', 404);
  return interview;
};

/**
 * @desc    Whether the interview is available, and the expert's latest one
 * @route   GET /api/expert-interview/status
 * @access  Private
 */
const getStatus = asyncHandler(async (req, res) => {
  let latest = await ExpertInterview.findOne({ userId: req.user._id, conversationId: { $type: 'string' } })
    .sort({ createdAt: -1 });

  // Catch up on a call whose end we never heard about (closed tab, lost connection)
  if (latest && elevenLabs.isConfigured()) {
    const stale = latest.status === 'in_progress' && Date.now() - latest.startedAt > STALE_CALL_MS;
    if (stale) {
      latest.status = 'processing';
      await latest.save();
    }
    if (latest.status === 'processing' && latest.fetchAttempts < MAX_FETCH_ATTEMPTS * 2) {
      await syncInterview(latest._id);
      latest = await ExpertInterview.findById(latest._id);
    }
  }

  const completed = latest?.status === 'completed'
    ? latest
    : await ExpertInterview.findOne({ userId: req.user._id, status: 'completed' }).sort({ completedAt: -1 });

  res.status(200).json({
    success: true,
    available: elevenLabs.isConfigured(),
    completed: !!completed,
    interview: publicView(completed || latest)
  });
});

/**
 * @desc    Start an interview: build the brief and issue a conversation token
 * @route   POST /api/expert-interview/session
 * @access  Private
 */
const createSession = asyncHandler(async (req, res, next) => {
  if (!elevenLabs.isConfigured()) {
    return next(new AppError('The voice interview is not available right now.', 503));
  }

  const user = await User.findById(req.user._id);
  const profile = user?.profiles?.expert ? await ExpertProfile.findById(user.profiles.expert) : null;
  if (!profile) return next(new AppError('Please set up your expert profile first.', 400));

  if (!profile.profiling?.completedAt && !user.onboarding?.expert?.completed) {
    return next(new AppError('Please finish your profile questions before the interview.', 400));
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await ExpertInterview.countDocuments({ userId: user._id, createdAt: { $gte: since } });
  if (recent >= MAX_SESSIONS_PER_DAY) {
    return next(new AppError('You have started several interviews today. Please try again tomorrow.', 429));
  }

  const { prompt, firstMessage, profileSnapshot } = buildInterviewBrief(user, profile);

  let conversationToken;
  try {
    conversationToken = await elevenLabs.getConversationToken();
  } catch (err) {
    console.error('[ExpertInterview] could not get a conversation token:', err.message);
    return next(new AppError('Could not start the interview. Please try again in a moment.', 502));
  }

  const interview = await ExpertInterview.create({
    userId: user._id,
    expertProfileId: profile._id,
    agentId: config.elevenlabs.agentId,
    prompt,
    firstMessage,
    profileSnapshot
  });

  res.status(201).json({
    success: true,
    interviewId: interview._id,
    conversationToken,
    overrides: { agent: { prompt: { prompt }, firstMessage } }
  });
});

/**
 * @desc    The call connected — record the ElevenLabs conversation id
 * @route   POST /api/expert-interview/:id/started
 * @access  Private
 */
const markStarted = asyncHandler(async (req, res, next) => {
  const conversationId = typeof req.body?.conversationId === 'string' ? req.body.conversationId.trim() : '';
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(conversationId)) {
    return next(new AppError('A valid conversationId is required', 400));
  }

  const interview = await findOwn(req);
  if (interview.conversationId && interview.conversationId !== conversationId) {
    return next(new AppError('This interview has already started', 409));
  }

  if (!interview.conversationId) {
    interview.conversationId = conversationId;
    interview.status = 'in_progress';
    interview.startedAt = new Date();
    try {
      await interview.save();
    } catch (err) {
      if (err.code === 11000) return next(new AppError('This conversation is already recorded', 409));
      throw err;
    }
  }

  res.status(200).json({ success: true, interview: publicView(interview) });
});

/**
 * @desc    The call ended — fetch and store the transcript
 * @route   POST /api/expert-interview/:id/ended
 * @access  Private
 */
const markEnded = asyncHandler(async (req, res) => {
  const interview = await findOwn(req);

  if (interview.status === 'in_progress') {
    interview.status = 'processing';
    interview.endedAt = new Date();
    await interview.save();
    pollUntilReady(interview._id);
  }

  res.status(200).json({ success: true, interview: publicView(interview) });
});

module.exports = { getStatus, createSession, markStarted, markEnded };
