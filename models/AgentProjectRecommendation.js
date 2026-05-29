const mongoose = require('mongoose');

const agentProjectRecommendationSchema = new mongoose.Schema(
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
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProjectCatalog',
      required: true,
      index: true
    },
    projectSlug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    projectTitle: {
      type: String,
      required: true,
      trim: true
    },
    businessGoal: {
      type: String,
      trim: true
    },
    requirementSummary: {
      type: String,
      trim: true
    },
    gapArea: {
      type: String,
      required: true,
      enum: ['awareness', 'discovery', 'connect', 'qualify', 'convert', 'retain']
    },
    gapScore: {
      type: Number,
      required: true,
      min: 1,
      max: 10
    },
    priority: {
      type: Number,
      required: true,
      min: 1
    },
    searchedSubjects: [{ type: String }],
    matchedSubjects: [{ type: String }],
    matchScore: {
      type: Number,
      default: 0
    },
    reason: {
      type: String,
      trim: true
    },
    gapSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    source: {
      type: String,
      default: 'gap_subject_mapping'
    },
    recommendationRunId: {
      type: String,
      required: true,
      index: true
    }
  },
  {
    timestamps: true
  }
);

agentProjectRecommendationSchema.index({ userId: 1, conversationId: 1, createdAt: -1 });
agentProjectRecommendationSchema.index({ conversationId: 1, gapArea: 1, priority: 1 });
agentProjectRecommendationSchema.index({ projectSlug: 1 });

module.exports = mongoose.model(
  'AgentProjectRecommendation',
  agentProjectRecommendationSchema,
  'agent_project_recommendations'
);
