const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema(
  {
    // Basic Campaign Info
    name: {
      type: String,
      required: [true, 'Campaign name is required'],
      trim: true,
      minlength: [2, 'Campaign name must be at least 2 characters'],
      maxlength: [100, 'Campaign name cannot exceed 100 characters']
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters']
    },

    // User Reference
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true
    },

    // Campaign Status
    status: {
      type: String,
      enum: {
        values: ['draft', 'scheduled', 'sending', 'completed', 'paused', 'failed'],
        message: 'Status must be draft, scheduled, sending, completed, paused, or failed'
      },
      default: 'draft',
      index: true
    },

    // Email Template Reference
    emailTemplateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EmailTemplate',
      required: [true, 'Email template is required']
    },

    // Selected Leads for Campaign
    selectedLeads: [{
      leadId: {
        type: String,
        required: true
      },
      email: {
        type: String,
        required: [true, 'Lead email is required'],
        lowercase: true,
        trim: true,
        match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address']
      },
      firstName: {
        type: String,
        trim: true
      },
      lastName: {
        type: String,
        trim: true
      },
      company: {
        type: String,
        trim: true
      },
      industry: {
        type: String,
        trim: true
      },
      jobTitle: {
        type: String,
        trim: true
      },
      location: {
        type: String,
        trim: true
      },
      phoneNumber: {
        type: String,
        trim: true
      }
    }],

    // Campaign Statistics
    stats: {
      totalLeads: {
        type: Number,
        default: 0,
        min: 0
      },
      sentCount: {
        type: Number,
        default: 0,
        min: 0
      },
      deliveredCount: {
        type: Number,
        default: 0,
        min: 0
      },
      openedCount: {
        type: Number,
        default: 0,
        min: 0
      },
      clickedCount: {
        type: Number,
        default: 0,
        min: 0
      },
      repliedCount: {
        type: Number,
        default: 0,
        min: 0
      },
      bouncedCount: {
        type: Number,
        default: 0,
        min: 0
      },
      spamCount: {
        type: Number,
        default: 0,
        min: 0
      },
      failedCount: {
        type: Number,
        default: 0,
        min: 0
      }
    },

    // Campaign Settings
    settings: {
      sendingRate: {
        type: Number,
        default: 100, // emails per hour
        min: [1, 'Sending rate must be at least 1 email per hour'],
        max: [500, 'Sending rate cannot exceed 500 emails per hour']
      },
      followUpEnabled: {
        type: Boolean,
        default: false
      },
      followUpDelayHours: {
        type: Number,
        default: 72, // 3 days
        min: [1, 'Follow-up delay must be at least 1 hour'],
        max: [720, 'Follow-up delay cannot exceed 720 hours (30 days)']
      },
      followUpTemplateId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmailTemplate'
      },
      timeZone: {
        type: String,
        default: 'UTC'
      },
      sendingHours: {
        start: {
          type: Number,
          default: 9,
          min: 0,
          max: 23
        },
        end: {
          type: Number,
          default: 17,
          min: 0,
          max: 23
        }
      }
    },

    // Scheduling
    scheduledAt: {
      type: Date
    },
    startedAt: {
      type: Date
    },
    completedAt: {
      type: Date
    },

    // Credits System Integration
    creditsPerEmail: {
      type: Number,
      default: 1,
      min: 0
    },
    totalCreditsConsumed: {
      type: Number,
      default: 0,
      min: 0
    },

    // Credits reserved upfront when campaign starts (for refund calculation)
    creditsReserved: {
      type: Number,
      default: 0,
      min: 0
    },

    // Email Provider Settings
    emailProvider: {
      type: String,
      enum: ['mailgun', 'sendgrid', 'ses'],
      default: 'mailgun'
    },

    // Integration with existing credit system
    useExistingCreditSystem: {
      type: Boolean,
      default: true
    },

    // Campaign Tags/Labels
    tags: [{
      type: String,
      trim: true,
      maxlength: 50
    }],

    // Error Tracking
    errors: [{
      message: String,
      timestamp: {
        type: Date,
        default: Date.now
      },
      leadEmail: String,
      errorType: {
        type: String,
        enum: ['validation', 'sending', 'api', 'credit', 'other'],
        default: 'other'
      }
    }],

    // Performance Metrics
    performance: {
      openRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
      },
      clickRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
      },
      replyRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
      },
      bounceRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
      },
      lastCalculatedAt: Date
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes for better query performance
campaignSchema.index({ userId: 1, status: 1 });
campaignSchema.index({ createdAt: -1 });
campaignSchema.index({ scheduledAt: 1 });
campaignSchema.index({ 'selectedLeads.email': 1 });
campaignSchema.index({ tags: 1 });
campaignSchema.index({ emailProvider: 1 });

// Virtual properties
campaignSchema.virtual('isActive').get(function () {
  return ['sending', 'scheduled'].includes(this.status);
});

campaignSchema.virtual('completionRate').get(function () {
  if (this.stats.totalLeads === 0) return 0;
  return Math.round((this.stats.sentCount / this.stats.totalLeads) * 100);
});

// Pre-save middleware
campaignSchema.pre('save', function () {
  // Update totalLeads count when selectedLeads changes
  if (this.isModified('selectedLeads')) {
    this.stats.totalLeads = this.selectedLeads.length;
  }

  // Calculate performance metrics
  if (this.stats.deliveredCount > 0) {
    this.performance.openRate = Math.round((this.stats.openedCount / this.stats.deliveredCount) * 100);
    this.performance.bounceRate = Math.round((this.stats.bouncedCount / this.stats.sentCount) * 100);
  }

  if (this.stats.openedCount > 0) {
    this.performance.clickRate = Math.round((this.stats.clickedCount / this.stats.openedCount) * 100);
  }

  if (this.stats.deliveredCount > 0) {
    this.performance.replyRate = Math.round((this.stats.repliedCount / this.stats.deliveredCount) * 100);
  }

  this.performance.lastCalculatedAt = new Date();
});

// Instance Methods
campaignSchema.methods.canBeStarted = function () {
  return ['draft', 'scheduled', 'paused'].includes(this.status);
};

campaignSchema.methods.canBePaused = function () {
  return this.status === 'sending';
};

campaignSchema.methods.canBeResumed = function () {
  return this.status === 'paused';
};

campaignSchema.methods.addError = function (message, leadEmail = null, errorType = 'other') {
  this.errors.push({
    message,
    leadEmail,
    errorType,
    timestamp: new Date()
  });

  // Keep only last 50 errors to prevent document bloat
  if (this.errors.length > 50) {
    this.errors = this.errors.slice(-50);
  }

  return this.save();
};

// Static Methods
campaignSchema.statics.findByUser = function (userId, filters = {}) {
  const query = { userId, ...filters };

  return this.find(query)
    .populate('emailTemplateId', 'templateName subject')
    .populate('settings.followUpTemplateId', 'templateName subject')
    .sort({ createdAt: -1 });
};

campaignSchema.statics.getActiveCampaigns = function () {
  return this.find({ status: { $in: ['sending', 'scheduled'] } })
    .populate('userId', 'fullName email')
    .populate('emailTemplateId', 'templateName subject');
};

campaignSchema.statics.getCampaignsByStatus = function (status) {
  return this.find({ status })
    .populate('emailTemplateId', 'templateName subject')
    .sort({ updatedAt: -1 });
};

campaignSchema.statics.getUserCampaignStats = async function (userId) {
  const stats = await this.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: null,
        totalCampaigns: { $sum: 1 },
        activeCampaigns: {
          $sum: {
            $cond: [{ $in: ['$status', ['sending', 'scheduled']] }, 1, 0]
          }
        },
        totalEmailsSent: { $sum: '$stats.sentCount' },
        totalEmailsOpened: { $sum: '$stats.openedCount' },
        totalCreditsConsumed: { $sum: '$totalCreditsConsumed' }
      }
    }
  ]);

  return stats[0] || {
    totalCampaigns: 0,
    activeCampaigns: 0,
    totalEmailsSent: 0,
    totalEmailsOpened: 0,
    totalCreditsConsumed: 0
  };
};

// Transform output
campaignSchema.methods.toJSON = function () {
  const campaign = this.toObject();
  delete campaign.__v;
  return campaign;
};

const Campaign = mongoose.model('Campaign', campaignSchema, 'campaigns');

module.exports = Campaign;