// utils/meetTranscript.js
// Fetches transcript from Google Meet REST API.
// Mock mode when OAuth credentials are missing — returns null transcript safely.

const isMockMode = () =>
  !process.env.GOOGLE_CLIENT_ID ||
  !process.env.GOOGLE_CLIENT_SECRET ||
  !process.env.GOOGLE_REFRESH_TOKEN;

function getOAuth2Client() {
  const { google } = require('googleapis');
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

// Extract meeting code from meetLink e.g. "https://meet.google.com/abc-defg-hij" → "abc-defg-hij"
function parseMeetingCode(meetLink) {
  if (!meetLink) return null;
  return meetLink.split('/').pop().split('?')[0];
}

/**
 * Fetches the transcript for a completed Google Meet call.
 * @param {{ meetLink: string }} params
 * @returns {{ isMock, conferenceRecordId, rawTranscript, entries }}
 */
async function getTranscriptForCall({ meetLink }) {
  if (isMockMode()) {
    console.log('[MeetTranscript] Mock mode — add Google OAuth credentials to .env');
    return { isMock: true, conferenceRecordId: null, rawTranscript: null, entries: [] };
  }

  const { google } = require('googleapis');
  const auth = getOAuth2Client();
  const meet = google.meet({ version: 'v2', auth });

  const meetingCode = parseMeetingCode(meetLink);
  if (!meetingCode) throw new Error('Invalid or missing Meet link');

  // Step 1: Resolve meeting code → space resource name
  const spaceRes = await meet.spaces.get({ name: `spaces/${meetingCode}` });
  const spaceName = spaceRes.data.name; // e.g. "spaces/XXXXXXX"

  // Step 2: Find the conference record for this space
  const recordsRes = await meet.conferenceRecords.list({
    filter: `space.name="${spaceName}"`,
  });

  const records = recordsRes.data.conferenceRecords || [];
  if (!records.length) {
    throw new Error(
      'No conference record found. The call may not have started yet, or it is still in progress.'
    );
  }

  // Use the most recent conference record
  const record = records[records.length - 1];
  const conferenceRecordId = record.name;

  // Step 3: List transcripts for this conference record
  const transcriptsRes = await meet.conferenceRecords.transcripts.list({
    parent: conferenceRecordId,
  });

  const transcripts = transcriptsRes.data.transcripts || [];
  if (!transcripts.length) {
    throw new Error(
      'No transcript found. Ensure "Transcripts" are enabled in Google Workspace Admin Console → Google Meet settings.'
    );
  }

  const transcriptName = transcripts[0].name;

  // Step 4: Fetch all transcript entries (paginated)
  const entries = [];
  let pageToken;

  do {
    const entriesRes = await meet.conferenceRecords.transcripts.entries.list({
      parent: transcriptName,
      ...(pageToken ? { pageToken } : {}),
    });

    const batch = entriesRes.data.transcriptEntries || [];
    for (const e of batch) {
      entries.push({
        startTime:   e.startTime   || null,
        endTime:     e.endTime     || null,
        speakerName: e.participant?.signedinUser?.displayName || 'Unknown',
        text:        e.text        || '',
      });
    }
    pageToken = entriesRes.data.nextPageToken;
  } while (pageToken);

  const rawTranscript = entries
    .map(e => `[${e.speakerName}]: ${e.text}`)
    .join('\n');

  return { isMock: false, conferenceRecordId, rawTranscript, entries };
}

module.exports = { getTranscriptForCall };
