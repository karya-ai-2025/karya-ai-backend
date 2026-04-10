const mongoose = require('mongoose');
const { Schema } = mongoose;

const projectUserSchema = new Schema({
  // User reference
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required']
  },

  // Project reference (internal Project model — used by project management routes)
  projectId: {
    type: Schema.Types.ObjectId,
    ref: 'Project',
    default: null
  },

  // Catalog reference (ProjectCatalog — used by marketplace purchase flow)
  catalogId: {
    type: Schema.Types.ObjectId,
    ref: 'ProjectCatalog',
    default: null
  },

  // Pricing tier selected at purchase time (credit / bronze / silver / gold)
  tierId: {
    type: String,
    enum: ['credit', 'bronze', 'silver', 'gold'],
    default: null
  },

  // Project slug for easy routing
  projectSlug: {
    type: String,
    required: [true, 'Project slug is required']
  },

  // Project status for this user
  status: {
    type: String,
    enum: ['started', 'in-progress', 'completed', 'paused'],
    default: 'started'
  },

  // Progress tracking
  progress: {
    currentStep: {
      type: Number,
      default: 1
    },
    totalSteps: {
      type: Number,
      default: 0
    },
    completedSteps: [{
      type: Number
    }],
    percentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    }
  },

  // Workspace data
  workspace: {
    configurations: {
      type: Schema.Types.Mixed,
      default: {}
    },
    customizations: {
      type: Schema.Types.Mixed,
      default: {}
    },
    integrations: {
      type: Schema.Types.Mixed,
      default: {}
    }
  },

  // Timestamps
  startedAt: {
    type: Date,
    default: Date.now
  },

  lastAccessedAt: {
    type: Date,
    default: Date.now
  },

  completedAt: {
    type: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better performance
projectUserSchema.index({ userId: 1 });
projectUserSchema.index({ projectId: 1 });
// Partial unique: only enforced when projectId is a real ObjectId (not null/missing).
// sparse: true does NOT skip null values — partialFilterExpression does.
projectUserSchema.index(
  { userId: 1, projectId: 1 },
  { unique: true, partialFilterExpression: { projectId: { $exists: true, $ne: null } } }
);
// Sparse unique: only enforced when catalogId is set (marketplace purchases)
projectUserSchema.index({ userId: 1, catalogId: 1 }, { unique: true, sparse: true });
projectUserSchema.index({ userId: 1, status: 1 });
projectUserSchema.index({ lastAccessedAt: -1 });

// Virtual for project info (populated)
projectUserSchema.virtual('project', {
  ref: 'Project',
  localField: 'projectId',
  foreignField: '_id',
  justOne: true
});

// Method to update last accessed
projectUserSchema.methods.updateLastAccessed = function() {
  this.lastAccessedAt = new Date();
  return this.save();
};

// Method to update progress
projectUserSchema.methods.updateProgress = function(stepData) {
  if (stepData.currentStep) {
    this.progress.currentStep = stepData.currentStep;
  }

  if (stepData.completedSteps) {
    this.progress.completedSteps = stepData.completedSteps;
  }

  if (stepData.totalSteps) {
    this.progress.totalSteps = stepData.totalSteps;
  }

  // Calculate percentage
  if (this.progress.totalSteps > 0) {
    this.progress.percentage = Math.round(
      (this.progress.completedSteps.length / this.progress.totalSteps) * 100
    );
  }

  return this.save();
};

// Static method to find user's projects
projectUserSchema.statics.getUserProjects = function(userId, options = {}) {
  const query = { userId };

  if (options.status) {
    query.status = options.status;
  }

  return this.find(query)
    .populate('projectId', 'name slug description status thumbnailImage isFeatured')
    .sort({ lastAccessedAt: -1 });
};

// Static method to check if user has access to project
projectUserSchema.statics.hasUserAccess = function(userId, projectId) {
  return this.findOne({ userId, projectId });
};

module.exports = mongoose.model('ProjectUser', projectUserSchema);