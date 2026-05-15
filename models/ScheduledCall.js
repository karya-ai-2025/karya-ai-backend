const mongoose = require('mongoose');
const { Schema } = mongoose;

const scheduledCallSchema = new Schema({
  userId:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name:         { type: String, required: true },
  email:        { type: String, required: true },
  dateTime:     { type: Date, required: true },
  timezone:     { type: String, default: 'UTC' },
  meetLink:     { type: String, default: null },   // null until GCP is configured
  googleEventId:{ type: String, default: null },
  status:       { type: String, enum: ['scheduled', 'completed', 'cancelled'], default: 'scheduled' },
  source:       { type: String, enum: ['onboarding-owner', 'onboarding-expert'], default: 'onboarding-owner' },

  // Admin completion
  completedAt: { type: Date, default: null }, // set by admin when call ends

  // Transcript pipeline
  transcriptFetched: { type: Boolean, default: false },
  fetchAttempts:     { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('ScheduledCall', scheduledCallSchema);
