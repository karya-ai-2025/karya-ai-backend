const mongoose = require('mongoose');
const { Schema } = mongoose;

// A call booked through Cal.com. Rows are written by the Cal.com webhook
// (routes/schedulingRoutes.js), never by the browser.
const scheduledCallSchema = new Schema({
  userId:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name:         { type: String, required: true },
  email:        { type: String, required: true },
  dateTime:     { type: Date, required: true },
  timezone:     { type: String, default: 'UTC' },
  meetLink:     { type: String, default: null },   // video link Cal.com generated for the booking
  calBookingUid:{ type: String },
  status:       { type: String, enum: ['scheduled', 'completed', 'cancelled'], default: 'scheduled' },
  source:       { type: String, enum: ['onboarding-owner', 'onboarding-expert'], default: 'onboarding-owner' },

  // Admin completion
  completedAt: { type: Date, default: null }, // set by admin when call ends

  // Reminder email
  reminderSent: { type: Boolean, default: false },

  // Transcript pipeline
  transcriptFetched: { type: Boolean, default: false },
  fetchAttempts:     { type: Number, default: 0 },
}, { timestamps: true });

scheduledCallSchema.index({ calBookingUid: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('ScheduledCall', scheduledCallSchema);
