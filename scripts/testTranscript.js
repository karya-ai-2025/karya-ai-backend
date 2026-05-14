// scripts/testTranscript.js
// Manually test the transcript fetch for a specific ScheduledCall.
// Usage: node scripts/testTranscript.js <scheduledCallId>
//
// Get the scheduledCallId from MongoDB after booking a call on the frontend.

require('dotenv').config();
const mongoose = require('mongoose');

const ScheduledCall            = require('../models/ScheduledCall');
const { getTranscriptForCall } = require('../utils/meetTranscript');

async function run() {
  const callId = process.argv[2];
  if (!callId) {
    console.error('Usage: node scripts/testTranscript.js <scheduledCallId>');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB\n');

  const call = await ScheduledCall.findById(callId).lean();
  if (!call) {
    console.error('ScheduledCall not found:', callId);
    process.exit(1);
  }

  console.log('Found call:');
  console.log('  Name:    ', call.name);
  console.log('  Email:   ', call.email);
  console.log('  DateTime:', call.dateTime);
  console.log('  MeetLink:', call.meetLink);
  console.log('  Status:  ', call.status);
  console.log();

  if (!call.meetLink) {
    console.error('No meetLink on this call — was it booked in mock mode?');
    process.exit(1);
  }

  console.log('Fetching transcript from Google Meet API...\n');

  try {
    const result = await getTranscriptForCall({ meetLink: call.meetLink });

    if (result.isMock) {
      console.log('Running in MOCK MODE — check GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN in .env');
      process.exit(0);
    }

    console.log('conferenceRecordId:', result.conferenceRecordId);
    console.log('Entry count:       ', result.entries.length);
    console.log();

    if (result.entries.length === 0) {
      console.log('No transcript entries found yet.');
      console.log('Make sure:');
      console.log('  1. The call actually happened (someone joined and spoke)');
      console.log('  2. Transcripts are enabled in Workspace Admin Console');
      console.log('  3. At least 5-10 minutes have passed since the call ended');
    } else {
      console.log('Transcript preview (first 5 entries):');
      result.entries.slice(0, 5).forEach(e => {
        console.log(`  [${e.speakerName}]: ${e.text}`);
      });
      console.log();
      console.log('Raw transcript (first 500 chars):');
      console.log(result.rawTranscript.slice(0, 500));
      console.log('\nTranscript fetch successful!');
    }
  } catch (err) {
    console.error('Transcript fetch failed:', err.message);
  }

  await mongoose.disconnect();
}

run().catch(console.error);
