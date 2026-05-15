const mongoose = require('mongoose');
const { Schema } = mongoose;

const projectNegotiationSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  projectSlug: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  tierId: {
    type: String,
    required: true,
    enum: ['credit', 'bronze', 'silver', 'gold'],
  },
  // Keys from ALL_TIER_DELIVERABLES that were included in the user's tier
  originalDeliverables: [{ type: String }],
  // Keys the user selected (subset of originalDeliverables)
  modifiedDeliverables: [{ type: String }],
  userNote: {
    type: String,
    trim: true,
    maxlength: 500,
    default: '',
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
}, {
  timestamps: true,
});

// One negotiation per user per project — enforces the "negotiate once" rule
projectNegotiationSchema.index({ userId: 1, projectSlug: 1 }, { unique: true });

module.exports = mongoose.model('ProjectNegotiation', projectNegotiationSchema);
