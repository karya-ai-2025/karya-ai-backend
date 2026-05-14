// jobs/transcriptJob.js
// Background job — polls every 5 minutes for calls that have ended and need transcript processing.
// Waits 20 minutes after call end time before fetching (gives Meet time to generate the transcript).

const ScheduledCall         = require('../models/ScheduledCall');
const { runTranscriptPipeline } = require('../utils/transcriptPipeline');

const POLL_INTERVAL_MS = 5  * 60 * 1000; // check every 5 minutes
const GRACE_PERIOD_MS  = 20 * 60 * 1000; // wait 20 min after admin marks complete
const MAX_ATTEMPTS     = 3;

let jobInterval = null;

async function processCompletedCalls() {
  try {
    const now    = new Date();
    // Only process calls where admin clicked "Complete" at least 20 min ago
    const cutoff = new Date(now.getTime() - GRACE_PERIOD_MS);

    const pendingCalls = await ScheduledCall.find({
      completedAt:       { $ne: null, $lt: cutoff }, // admin marked complete + 20min passed
      transcriptFetched: { $ne: true },
      fetchAttempts:     { $lt: MAX_ATTEMPTS },
      meetLink:          { $ne: null },
    }).limit(10);

    if (!pendingCalls.length) return;

    console.log(`[TranscriptJob] Processing ${pendingCalls.length} completed call(s)`);

    for (const call of pendingCalls) {
      try {
        await runTranscriptPipeline(call._id.toString());
      } catch (err) {
        // Error already logged inside pipeline; continue with next call
      }
    }
  } catch (err) {
    console.error('[TranscriptJob] Poll error:', err.message);
  }
}

function startTranscriptJob() {
  if (jobInterval) return; // already running
  console.log('[TranscriptJob] Started — polling every 5 minutes for completed calls');
  processCompletedCalls(); // run once immediately on server start
  jobInterval = setInterval(processCompletedCalls, POLL_INTERVAL_MS);
}

function stopTranscriptJob() {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
    console.log('[TranscriptJob] Stopped');
  }
}

module.exports = { startTranscriptJob, stopTranscriptJob };
