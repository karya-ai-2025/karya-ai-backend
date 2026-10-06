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
    // ── Tenant ───────────────────────────────────────────────────────────
    // Which ORGANIZATION owns this record. userId above stays, but now means
    // "who created it" rather than "who owns it" — queries scope on this.
    //
    // Optional for now so existing records stay readable during migration;
    // tightened to required once every document is backfilled.
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true
    },

    // ── Hierarchy ─────────────────────────────────────────────────────────
    // A campaign is either a parent (a folder grouping sub-campaigns) or a leaf
    // that actually sends. Parents own no leads, no template and no stats of
    // their own — their numbers are the sum of their children.
    parentCampaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      default: null,
      index: true
    },

    isParent: {
      type: Boolean,
      default: false,
      index: true
    },

    // ── PARKED: human-readable campaign code ────────────────────────────
    // Undecided — nothing generates this yet and MongoDB _id is already the
    // real unique identifier. To bring it back: uncomment below, decide
    // whether it needs unique: true, add generation in createCampaign, and
    // re-add campaignCode to the projections in controllers/icpController.js
    // plus the render in components/Projects/HotLeadInBox/ICP/index.jsx.
    // // Human-readable code shown to customers ("FIN-BLR-001").
    // // MongoDB _id stays the real identifier; this is for conversations.
    // campaignCode: {
    //   type: String,
    //   trim: true,
    //   uppercase: true,
    //   sparse: true,
    //   index: true
    // },
    // ────────────────────────────────────────────────────────────────────

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
      // Parent campaigns are folders — they never send, so they carry no template.
      // Leaf campaigns still require one before they can start.
      required: [
        function () { return !this.isParent; },
        'Email template is required'
      ]
    },

    // ── The four-email sequence ───────────────────────────────────────────
    // A campaign is never one send. The wizard collects a template for each
    // step, so the ICP the customer approves is already written rather than
    // four empty boxes for the admin to fill in.
    //
    // emailTemplateId above stays the step-1 template, so everything that
    // already reads it (sending, stats, the ICP preview) keeps working.
    sequenceTemplates: [{
      step: { type: Number, min: 1, max: 10 },
      key: {
        type: String,
        enum: ['initial', 'follow_up', 'recall', 'final']
      },
      templateId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmailTemplate'
      }
    }],

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
      // What those replies actually said. Counted from the classified intent on
      // each CampaignEmail, so the campaign can report outcomes rather than
      // just "someone wrote back".
      meetingRequestCount: {
        type: Number,
        default: 0,
        min: 0
      },
      interestedCount: {
        type: Number,
        default: 0,
        min: 0
      },
      notInterestedCount: {
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
    errorLogs: [{
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
    },

    // Follow-up / reminder rounds sent on this campaign after the primary blast.
    // The campaign stays the container; each round is a segment-targeted resend.
    rounds: [{
      type: { type: String },       // 'follow-up'
      segment: { type: String },    // 'opened' | 'not-opened' | 'clicked'
      templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailTemplate' },
      sentCount: { type: Number, default: 0 },
      sentAt: { type: Date, default: Date.now }
    }],

    // ── Admin-on-behalf ──────────────────────────────────────────────────
    // Set when an admin built this campaign for a customer after a call.
    // userId stays the customer's throughout — this only records who acted,
    // so "who sent this?" always has an answer.
    createdByAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },

    // Append-only trail of every admin action taken on someone else's
    // campaign. Identifying information only — never a token or credential.
    adminActions: [{
      action: {
        type: String,
        enum: ['created', 'started', 'updated', 'leads_added'],
        required: true
      },
      adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      adminEmail: { type: String, trim: true },
      note: { type: String, trim: true },
      at: { type: Date, default: Date.now }
    }]
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
campaignSchema.index({ createdByAdmin: 1, createdAt: -1 });

/**
 * Roll a parent campaign up from its children.
 * Parents hold no counters of their own, so their numbers are summed on read.
 * Returns the same { stats, performance } shape a leaf campaign exposes.
 */
campaignSchema.statics.rollUpParent = async function (parentId) {
  const children = await this.find({ parentCampaignId: parentId }).select(`stats`).lean();

  const stats = children.reduce((acc, c) => {
    for (const k of Object.keys(acc)) acc[k] += (c.stats && c.stats[k]) || 0;
    return acc;
  }, {
    totalLeads: 0, sentCount: 0, deliveredCount: 0, openedCount: 0,
    clickedCount: 0, repliedCount: 0, bouncedCount: 0, spamCount: 0, failedCount: 0
  });

  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

  return {
    childCount: children.length,
    stats,
    performance: {
      openRate:   pct(stats.openedCount,  stats.deliveredCount),
      clickRate:  pct(stats.clickedCount, stats.openedCount),
      replyRate:  pct(stats.repliedCount, stats.deliveredCount),
      bounceRate: pct(stats.bouncedCount, stats.sentCount),
      lastCalculatedAt: new Date()
    }
  };
};
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
  // A parent is a folder — it groups children and never sends on its own.
  if (this.isParent) return false;
  return ['draft', 'scheduled', 'paused'].includes(this.status);
};

campaignSchema.methods.canBePaused = function () {
  return this.status === 'sending';
};

campaignSchema.methods.canBeResumed = function () {
  return this.status === 'paused';
};

campaignSchema.methods.addError = function (message, leadEmail = null, errorType = 'other') {
  this.errorLogs.push({
    message,
    leadEmail,
    errorType,
    timestamp: new Date()
  });

  // Keep only last 50 error logs to prevent document bloat
  if (this.errorLogs.length > 50) {
    this.errorLogs = this.errorLogs.slice(-50);
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

/**
 * The same list, but scoped by an already-built tenant filter rather than a
 * bare userId.
 *
 * Callers pass tenantFilter(req), which is `{ userId }` while org scoping is
 * off and an organization-scoped filter once it is on — so this one static
 * serves both, and there is no moment where the list and the detail view
 * disagree about who owns what.
 */
campaignSchema.statics.findForTenant = function (tenant = {}, filters = {}) {
  return this.find({ ...tenant, ...filters })
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

// Tenant-scoped lookups — every org-scoped query starts with organizationId.
campaignSchema.index({ organizationId: 1, status: 1, createdAt: -1 });

const Campaign = mongoose.model('Campaign', campaignSchema, 'campaigns');

module.exports = Campaign;
