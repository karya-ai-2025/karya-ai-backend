const mongoose = require('mongoose');

// Human-in-the-loop approval request. Created when a user sends an
// AI-generated artifact (e.g. an outbound email draft) for review. Surfaces on
// the HITL approval page and the dashboard Attention Center.
const hitlRequestSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    projectSlug: { type: String, trim: true, default: '' },
    type: {
      type: String,
      enum: ['email_approval'],
      default: 'email_approval'
    },
    title: { type: String, trim: true, required: true },
    // Expert-review loop:
    //  with_expert  → admin needs to review/refine (shows on admin page)
    //  awaiting_user → admin sent it back; user needs to approve (HITL page + Attention Center)
    //  approved     → user approved; email saved & campaign-ready
    //  rejected     → user rejected
    status: {
      type: String,
      enum: ['with_expert', 'awaiting_user', 'approved', 'rejected', 'pending', 'revision_requested'],
      default: 'with_expert',
      index: true
    },
    // The artifact awaiting approval (email draft).
    payload: {
      subject: { type: String, default: '' },
      body: { type: String, default: '' },
      audience: { type: String, default: '' },
      tone: { type: String, default: '' }
    },
    // The inputs that produced the artifact (the assistant's collected answers).
    context: { type: mongoose.Schema.Types.Mixed, default: {} },
    reviewerNote: { type: String, default: '' },   // note from the user to the expert
    expertNote: { type: String, default: '' },      // note from the expert back to the user
    revisionCount: { type: Number, default: 0 },     // how many user→expert round-trips
    reviewedAt: { type: Date }
  },
  { timestamps: true }
);

hitlRequestSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('HitlRequest', hitlRequestSchema);
