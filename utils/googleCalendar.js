// utils/googleCalendar.js
// Creates a Google Calendar event with a Google Meet link using OAuth2.
// Runs in MOCK MODE when env vars are not set — no crashes, just no real link.

const isMockMode = () =>
  !process.env.GOOGLE_CLIENT_ID ||
  !process.env.GOOGLE_CLIENT_SECRET ||
  !process.env.GOOGLE_REFRESH_TOKEN;

/**
 * Creates a Google Calendar event with Meet conferencing.
 * @returns {{ eventId: string|null, meetLink: string|null, isMock: boolean }}
 */
async function createMeetEvent({ summary, description, startTime, endTime, attendeeEmail, timezone = 'UTC' }) {
  if (isMockMode()) {
    console.log('[GoogleCalendar] Mock mode — add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN to .env');
    return { eventId: null, meetLink: null, isMock: true };
  }

  const { google } = require('googleapis');

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

  const calendar = google.calendar({ version: 'v3', auth });

  const response = await calendar.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
    conferenceDataVersion: 1,
    sendUpdates: 'none',
    requestBody: {
      summary,
      description,
      start: { dateTime: startTime, timeZone: timezone },
      end:   { dateTime: endTime,   timeZone: timezone },
      attendees: [{ email: attendeeEmail }],
      conferenceData: {
        createRequest: {
          requestId: `karya-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    },
  });

  const meetLink =
    response.data.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri || null;

  return { eventId: response.data.id, meetLink, isMock: false };
}

module.exports = { createMeetEvent };
