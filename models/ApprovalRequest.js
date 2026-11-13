// models/ApprovalRequest.js
//
// One request for the client's (the business's) decision, inside one project.
// The one place the client decides things:
//
//   campaign_launch  a campaign is ready to send. Approving it launches it,
//                    paid from the business's credits — but only if the
//                    campaign is still exactly what was submitted
//                    (contentHash); an edit after submitting needs a new
//                    request.
//   decision         any question the people doing the work need answered
//
// (Milestones and tasks are the agency's own planning — the client follows
// their progress but doesn't approve them.)
//
// Workers raise requests; the business decides. Each has a comment thread.

const mongoose = require('mongoose');

const TYPES = ['campaign_launch', 'decision'];
const STATUSES = ['pending', 'approved', 'rejected', 'changes_requested', 'cancelled'];

const approvalRequestSchema = new mongoose.Schema(
  {
    // Whose project (the business) and which one
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    // Null only for work not tied to a project (older campaigns, or ones
    // Karya built outside a project) — still the business's to decide.
    projectInstanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectUser', default: null, index: true },
    // Set when a worker raised it through their engagement
    engagementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Engagement', default: null },

    type: { type: String, enum: TYPES, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 4000, default: '' },

    // What it is about
    target: {
      type: { type: String },                     // 'Campaign'
      id: { type: mongoose.Schema.Types.ObjectId },
    },
    // Type-specific detail
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    // campaign_launch: fingerprint of the campaign as submitted
    contentHash: { type: String, default: null },

    status: { type: String, enum: STATUSES, default: 'pending', index: true },

    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    requestedByOrgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
    side: { type: String, enum: ['business', 'partner'], required: true },   // who asked

    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
    decisionNote: { type: String, trim: true, maxlength: 2000, default: '' },
    // What deciding did, e.g. a launch: { launched: true, message }
    outcome: { type: mongoose.Schema.Types.Mixed, default: null },

    comments: [{
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      side: { type: String, enum: ['business', 'partner'], required: true },
      text: { type: String, required: true, trim: true, maxlength: 2000 },
      at: { type: Date, default: Date.now },
    }],
  },
  { timestamps: true }
);

approvalRequestSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
approvalRequestSchema.index({ requestedByOrgId: 1, status: 1, updatedAt: -1 });
approvalRequestSchema.index({ 'target.id': 1, status: 1 });

approvalRequestSchema.statics.TYPES = TYPES;
approvalRequestSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model('ApprovalRequest', approvalRequestSchema);
