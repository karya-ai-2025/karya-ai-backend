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
  isMock:           { type: Boolean, default: false }, // true when any step used mock mode
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

module.exports = mongoose.model('CallTranscript', callTranscriptSchema);
