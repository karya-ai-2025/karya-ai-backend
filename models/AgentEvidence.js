const mongoose = require('mongoose');

const evidenceSignalSchema = new mongoose.Schema({
  label: String,
  value: String
}, { _id: false });

const agentEvidenceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true
    },
    kind: {
      type: String,
      enum: ['website'],
      required: true,
      index: true
    },
    url: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      enum: ['stored', 'parsed', 'failed'],
      default: 'stored',
      index: true
    },
    extractedText: {
      type: String,
      default: ''
    },
    summary: {
      type: String,
      default: ''
    },
    signals: [evidenceSignalSchema],
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

agentEvidenceSchema.index({ userId: 1, conversationId: 1, kind: 1, createdAt: -1 });
agentEvidenceSchema.index({ conversationId: 1, url: 1 }, { sparse: true });

const AgentEvidence = mongoose.model('AgentEvidence', agentEvidenceSchema);

module.exports = AgentEvidence;
