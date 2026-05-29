// utils/transcriptPipeline.js
// Orchestrates: fetch transcript → extract profile via Claude → save to DB → mark call complete.

const ScheduledCall   = require('../models/ScheduledCall');
const CallTranscript  = require('../models/CallTranscript');
const { getTranscriptForCall }       = require('./meetTranscript');
const { extractProfileFromTranscript } = require('./extractProfile');

const MAX_FETCH_ATTEMPTS = 3;

/**
 * Runs the full transcript pipeline for a completed call.
 * Idempotent — safe to call multiple times; skips if already processed.
 *
 * @param {string} scheduledCallId
 * @returns {{ success, skipped, transcriptId, extractedData, isMock }}
 */
async function runTranscriptPipeline(scheduledCallId) {
  const call = await ScheduledCall.findById(scheduledCallId);
  if (!call) throw new Error(`ScheduledCall not found: ${scheduledCallId}`);

  if (call.transcriptFetched) {
    return { success: true, skipped: true, reason: 'Already processed' };
  }

  if (call.fetchAttempts >= MAX_FETCH_ATTEMPTS) {
    return { success: false, skipped: true, reason: `Max fetch attempts (${MAX_FETCH_ATTEMPTS}) reached` };
  }

  // Increment attempt counter immediately so concurrent runs don't double-process
  await ScheduledCall.findByIdAndUpdate(scheduledCallId, { $inc: { fetchAttempts: 1 } });

  // Find or create the transcript record
  let transcript = await CallTranscript.findOne({ scheduledCallId });
  if (!transcript) {
    transcript = await CallTranscript.create({
      scheduledCallId,
      userId: call.userId,
      status: 'fetching',
    });
  } else {
    await CallTranscript.findByIdAndUpdate(transcript._id, { status: 'fetching', fetchError: null });
  }

  try {
    // ── Step 1: Fetch transcript from Google Meet ──────────────────────────
    const { conferenceRecordId, rawTranscript, entries, isMock: meetMock } =
      await getTranscriptForCall({ meetLink: call.meetLink });

    await CallTranscript.findByIdAndUpdate(transcript._id, {
      conferenceRecordId,
      rawTranscript,
      entries,
      isMock: meetMock,
    });

    // ── Step 2: Extract profile data via Claude ────────────────────────────
    let extractedData = null;
    let isMockExtract = false;

    if (rawTranscript) {
      const userType = call.source?.includes('expert') ? 'expert' : 'owner';
      const result   = await extractProfileFromTranscript({ rawTranscript, userType });
      extractedData  = result.extractedData;
      isMockExtract  = result.isMock;
    }

    // ── Step 3: Save extracted data ────────────────────────────────────────
    await CallTranscript.findByIdAndUpdate(transcript._id, {
      extractedData,
      isMock:  meetMock || isMockExtract,
      status: 'extracted',
    });

    // ── Step 4: Mark call as processed ────────────────────────────────────
    await ScheduledCall.findByIdAndUpdate(scheduledCallId, {
      transcriptFetched: true,
      status: 'completed',
    });

    console.log(`[TranscriptPipeline] ✓ Call ${scheduledCallId} processed successfully`);

    return {
      success:       true,
      skipped:       false,
      transcriptId:  transcript._id,
      extractedData,
      isMock:        meetMock || isMockExtract,
    };

  } catch (err) {
    console.error(`[TranscriptPipeline] ✗ Call ${scheduledCallId} failed:`, err.message);

    await CallTranscript.findByIdAndUpdate(transcript._id, {
      fetchError: err.message,
      status:     'failed',
    });

    throw err;
  }
}

module.exports = { runTranscriptPipeline };
