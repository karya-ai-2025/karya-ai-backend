const mongoose = require('mongoose');

const userCreditConsumptionSchema = new mongoose.Schema(
  {
    // User who performed the action
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required']
    },

    // User's active plan at the time of consumption
    userPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserPlan',
      required: [true, 'User Plan ID is required']
    },

    // Type of action performed
    actionType: {
      type: String,
      required: [true, 'Action type is required'],
      enum: {
        values: ['VIEW_EMAIL', 'VIEW_PHONE', 'DOWNLOAD_LEADS'],
        message: 'Action type must be VIEW_EMAIL, VIEW_PHONE, or DOWNLOAD_LEADS'
      }
    },

    // Number of credits consumed
    creditsConsumed: {
      type: Number,
      required: [true, 'Credits consumed is required'],
      min: [0, 'Credits consumed cannot be negative']
    },

    // Lead information (if applicable)
    leadId: {
      type: String, // Using String since leads are in Prisma/PostgreSQL
      required: function() {
        return this.actionType === 'VIEW_EMAIL' || this.actionType === 'VIEW_PHONE';
      }
    },

    leadEmail: {
      type: String,
      trim: true,
      required: function() {
        return this.actionType === 'VIEW_EMAIL';
      }
    },

    leadPhone: {
      type: String,
      trim: true,
      required: function() {
        return this.actionType === 'VIEW_PHONE';
      }
    },

    leadName: {
      type: String,
      trim: true
    },

    leadCompany: {
      type: String,
      trim: true
    },

    // Request metadata
    ipAddress: {
      type: String,
      trim: true
    },

    userAgent: {
      type: String,
      trim: true
    },

    // Project context (if applicable)
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project'
    },

    // Additional metadata
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

// Indexes for efficient queries
userCreditConsumptionSchema.index({ userId: 1, createdAt: -1 });
userCreditConsumptionSchema.index({ userPlanId: 1, actionType: 1 });
userCreditConsumptionSchema.index({ actionType: 1, createdAt: -1 });
userCreditConsumptionSchema.index({ leadId: 1, userId: 1 });

// Static method to get user's consumption history
userCreditConsumptionSchema.statics.getUserHistory = function(userId, page = 1, limit = 10) {
  const skip = (page - 1) * limit;

  return this.find({ userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('userPlanId', 'planId planPackageId')
    .populate('projectId', 'name');
};

// Static method to get consumption statistics
userCreditConsumptionSchema.statics.getConsumptionStats = function(userId, startDate, endDate) {
  const matchCriteria = { userId };

  if (startDate || endDate) {
    matchCriteria.createdAt = {};
    if (startDate) matchCriteria.createdAt.$gte = new Date(startDate);
    if (endDate) matchCriteria.createdAt.$lte = new Date(endDate);
  }

  return this.aggregate([
    { $match: matchCriteria },
    {
      $group: {
        _id: '$actionType',
        totalCredits: { $sum: '$creditsConsumed' },
        count: { $sum: 1 }
      }
    },
    { $sort: { totalCredits: -1 } }
  ]);
};

// Static method to check if user has already viewed this lead's email/phone
userCreditConsumptionSchema.statics.hasUserViewedLead = function(userId, leadId, actionType) {
  return this.findOne({
    userId,
    leadId,
    actionType
  });
};

// Instance method to get readable action description
userCreditConsumptionSchema.methods.getActionDescription = function() {
  switch (this.actionType) {
    case 'VIEW_EMAIL':
      return `Viewed email for ${this.leadName || 'lead'}`;
    case 'VIEW_PHONE':
      return `Viewed phone number for ${this.leadName || 'lead'}`;
    case 'DOWNLOAD_LEADS':
      return 'Downloaded leads data';
    default:
      return 'Unknown action';
  }
};

const UserCreditConsumption = mongoose.model('UserCreditConsumption', userCreditConsumptionSchema);

module.exports = UserCreditConsumption;