const mongoose = require('mongoose');
const { Schema } = mongoose;

const callTranscriptSchema = new Schema({
  scheduledCallId: { type: Schema.Types.ObjectId, ref: 'ScheduledCall', required: true },
  userId:          { type: Schema.Types.ObjectId, ref: 'User', required: true },

  // Raw data from Google Meet API
  conferenceRecordId: { type: String, default: null },
  entries: [{
    startTime:   { type: String },
    endTime:     { type: String },
    speakerName: { type: String },
    text:        { type: String },
  }],
  rawTranscript: { type: String, default: null }, // full stitched text

  // Extracted profile info from Claude
  extractedData: {
    name:            { type: String },
    businessType:    { type: String },
    industry:        { type: String },
    companyName:     { type: String },
    goals:           [{ type: String }],
    painPoints:      [{ type: String }],
    budget:          { type: String },
    timeline:        { type: String },
    teamSize:        { type: String },
    currentTools:    [{ type: String }],
    expertiseNeeded: [{ type: String }],
    skills:          [{ type: String }], // for expert onboarding calls
    notes:           { type: String },
    confidence:      { type: String, enum: ['high', 'medium', 'low'] },
  },

  // Flags
  // `isMock` is the combined flag the UI reads: true when EITHER step used mock
  // mode. It used to be the only flag, which meant it could never be cleared —
  // a transcript fetched before the API keys were configured stayed marked as
  // mock forever, even after a real re-extraction. The two stage flags below
  // record each step separately so the combined value can be recomputed.
  isMock:           { type: Boolean, default: false },
  meetIsMock:       { type: Boolean, default: undefined }, // Google Meet fetch used mock mode
  extractIsMock:    { type: Boolean, default: undefined }, // Claude extraction used mock mode
  appliedToProfile: { type: Boolean, default: false },
  reviewedByAdmin:  { type: Boolean, default: false },

  // Error tracking
  fetchError:   { type: String, default: null },
  extractError: { type: String, default: null },

  status: {
    type: String,
    enum: ['pending', 'fetching', 'extracted', 'applied', 'failed'],
    default: 'pending',
  },
}, { timestamps: true });

callTranscriptSchema.index({ scheduledCallId: 1 });
callTranscriptSchema.index({ userId: 1 });
callTranscriptSchema.index({ status: 1 });

/**
 * Was the Meet fetch mocked?
 *
 * Records written before meetIsMock existed don't carry the flag, so fall back
 * to the evidence: mock mode returns conferenceRecordId null and no text, while
 * a real fetch always sets a conferenceRecordId.
 */
callTranscriptSchema.statics.inferMeetIsMock = function (doc) {
  if (typeof doc.meetIsMock === 'boolean') return doc.meetIsMock;
  return !doc.conferenceRecordId;
};

module.exports = mongoose.model('CallTranscript', callTranscriptSchema);
