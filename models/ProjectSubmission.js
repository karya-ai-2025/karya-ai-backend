const mongoose = require('mongoose');
const { Schema } = mongoose;

const projectSubmissionSchema = new Schema({

  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  // How the user chose to submit
  submissionType: {
    type: String,
    enum: ['form', 'call'],
    required: true,
  },

  // ── Basic info (Step 1 of form) ───────────────────────────────
  title: {
    type: String,
    required: [true, 'Project title is required'],
    trim: true,
    maxlength: 120,
  },
  tagline: {
    type: String,
    trim: true,
    maxlength: 200,
  },
  category: {
    type: String,
    enum: ['outbound', 'outreach', 'email', 'brand', 'traffic',
           'intelligence', 'relationship', 'assistant', 'ai-matching'],
  },
  description: {
    type: String,
    trim: true,
    maxlength: 2000,
  },

  // ── Goals & Audience (Step 2 of form) ────────────────────────
  goals: {
    type: String,
    trim: true,
    maxlength: 1000,
  },
  targetAudience: {
    type: String,
    trim: true,
    maxlength: 500,
  },
  budget: {
    min:      { type: Number },
    max:      { type: Number },
    currency: { type: String, default: 'INR' },
  },
  timeline: {
    type: String,
    trim: true,
    maxlength: 100,
  },

  // ── Requirements (Step 3 of form) ────────────────────────────
  expertSkillsNeeded: [{ type: String, trim: true }],
  toolsUsed:          [{ type: String, trim: true }],
  deliverables:       [{ type: String, trim: true }],

  // ── Call scheduling (used when submissionType === 'call') ─────
  scheduledCall: {
    date:     { type: String },  // ISO date string e.g. "2026-04-15"
    time:     { type: String },  // e.g. "10:00 AM"
    notes:    { type: String, trim: true, maxlength: 1000 },
    timezone: { type: String, default: 'Asia/Kolkata' },
  },

  // ── Review workflow ───────────────────────────────────────────
  status: {
    type: String,
    enum: ['submitted', 'under-review', 'approved', 'rejected', 'published'],
    default: 'submitted',
  },
  adminNotes: {
    type: String,
    trim: true,
  },

  // Set when admin approves and publishes to marketplace
  catalogId: {
    type: Schema.Types.ObjectId,
    ref: 'ProjectCatalog',
    default: null,
  },

}, {
  timestamps: true,
});

projectSubmissionSchema.index({ userId: 1, createdAt: -1 });
projectSubmissionSchema.index({ status: 1 });

module.exports = mongoose.model('ProjectSubmission', projectSubmissionSchema);
