const mongoose = require('mongoose');

const campaignEmailSchema = new mongoose.Schema(
  {
    // References
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: [true, 'Campaign ID is required'],
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true
    },

    // Lead Information
    leadId: {
      type: String,
      required: [true, 'Lead ID is required'],
      index: true
    },
    leadEmail: {
      type: String,
      required: [true, 'Lead email is required'],
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
      index: true
    },
    leadName: {
      type: String,
      trim: true
    },
    leadCompany: {
      type: String,
      trim: true
    },

    // Email Content (Personalized)
    personalizedSubject: {
      type: String,
      required: [true, 'Personalized subject is required'],
      trim: true
    },
    personalizedBody: {
      type: String,
      required: [true, 'Personalized body is required'],
      trim: true
    },

    // Email Type
    emailType: {
      type: String,
      enum: {
        values: ['primary', 'follow-up'],
        message: 'Email type must be primary or follow-up'
      },
      default: 'primary',
      index: true
    },

    // Delivery Status
    status: {
      type: String,
      enum: {
        values: ['pending', 'queued', 'sending', 'sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'spam', 'failed', 'cancelled'],
        message: 'Invalid email status'
      },
      default: 'pending',
      index: true
    },

    // Email Provider Data
    mailgunMessageId: {
      type: String,
      index: true,
      sparse: true // Allow multiple null values
    },
    sendgridMessageId: {
      type: String,
      index: true,
      sparse: true
    },
    sesMessageId: {
      type: String,
      index: true,
      sparse: true
    },

    // Tracking Data
    trackingData: {
      ipAddress: String,
      userAgent: String,
      location: {
        country: String,
        region: String,
        city: String
      },
      device: {
        type: String, // desktop, mobile, tablet
        os: String,
        browser: String
      }
    },

    // Event Timestamps
    queuedAt: Date,
    sentAt: Date,
    deliveredAt: Date,
    openedAt: Date,
    firstOpenedAt: Date, // Track first open separately
    clickedAt: Date,
    firstClickedAt: Date, // Track first click separately
    repliedAt: Date,
    bouncedAt: Date,
    unsubscribedAt: Date,

    // Open and Click Tracking
    opens: [{
      timestamp: {
        type: Date,
        default: Date.now
      },
      ipAddress: String,
      userAgent: String
    }],

    clicks: [{
      timestamp: {
        type: Date,
        default: Date.now
      },
      url: String,
      ipAddress: String,
      userAgent: String
    }],

    // Bounce Information
    bounceInfo: {
      bounceType: {
        type: String,
        enum: ['hard', 'soft', 'complaint']
      },
      bounceReason: String,
      bounceCode: String
    },

    // Error Handling
    errorMessage: String,
    errorCode: String,
    retryCount: {
      type: Number,
      default: 0,
      min: 0
    },
    maxRetries: {
      type: Number,
      default: 3,
      min: 0
    },
    nextRetryAt: Date,

    // Email Provider Event Data (Raw webhooks)
    providerEvents: [{
      eventType: String, // delivered, opened, clicked, bounced, etc.
      eventData: mongoose.Schema.Types.Mixed,
      receivedAt: {
        type: Date,
        default: Date.now
      }
    }],

    // Scheduling
    scheduledFor: {
      type: Date,
      index: true
    },
    priority: {
      type: Number,
      default: 5, // 1 = highest, 10 = lowest
      min: 1,
      max: 10,
      index: true
    },

    // Credits
    creditsConsumed: {
      type: Number,
      default: 1,
      min: 0
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes for better query performance
campaignEmailSchema.index({ campaignId: 1, status: 1 });
campaignEmailSchema.index({ userId: 1, status: 1 });
campaignEmailSchema.index({ leadEmail: 1, campaignId: 1 });
campaignEmailSchema.index({ scheduledFor: 1, status: 1 });
campaignEmailSchema.index({ status: 1, priority: 1, scheduledFor: 1 });
campaignEmailSchema.index({ sentAt: 1 });
campaignEmailSchema.index({ createdAt: -1 });

// Compound indexes for common queries
campaignEmailSchema.index({ campaignId: 1, emailType: 1, status: 1 });
campaignEmailSchema.index({ userId: 1, createdAt: -1 });

// Virtual properties
campaignEmailSchema.virtual('wasOpened').get(function () {
  return this.opens && this.opens.length > 0;
});

campaignEmailSchema.virtual('wasClicked').get(function () {
  return this.clicks && this.clicks.length > 0;
});

campaignEmailSchema.virtual('openCount').get(function () {
  return this.opens ? this.opens.length : 0;
});

campaignEmailSchema.virtual('clickCount').get(function () {
  return this.clicks ? this.clicks.length : 0;
});

campaignEmailSchema.virtual('isDelivered').get(function () {
  return ['delivered', 'opened', 'clicked', 'replied'].includes(this.status);
});

campaignEmailSchema.virtual('canRetry').get(function () {
  return this.status === 'failed' && this.retryCount < this.maxRetries;
});

// Pre-save middleware
campaignEmailSchema.pre('save', function () {
  // Set first opened/clicked timestamps
  if (this.isModified('opens') && this.opens.length > 0 && !this.firstOpenedAt) {
    this.firstOpenedAt = this.opens[0].timestamp;
    if (!this.openedAt) this.openedAt = this.firstOpenedAt;
  }

  if (this.isModified('clicks') && this.clicks.length > 0 && !this.firstClickedAt) {
    this.firstClickedAt = this.clicks[0].timestamp;
    if (!this.clickedAt) this.clickedAt = this.firstClickedAt;
  }

  // Update status based on events
  if (this.isModified('opens') && this.opens.length > 0 && this.status === 'delivered') {
    this.status = 'opened';
  }

  if (this.isModified('clicks') && this.clicks.length > 0 && ['delivered', 'opened'].includes(this.status)) {
    this.status = 'clicked';
  }
});

// Instance Methods
campaignEmailSchema.methods.recordOpen = function (ipAddress, userAgent) {
  this.opens.push({
    timestamp: new Date(),
    ipAddress,
    userAgent
  });

  if (!this.firstOpenedAt) {
    this.firstOpenedAt = new Date();
  }
  this.openedAt = new Date();

  if (this.status === 'delivered') {
    this.status = 'opened';
  }

  return this.save();
};

campaignEmailSchema.methods.recordClick = function (url, ipAddress, userAgent) {
  this.clicks.push({
    timestamp: new Date(),
    url,
    ipAddress,
    userAgent
  });

  if (!this.firstClickedAt) {
    this.firstClickedAt = new Date();
  }
  this.clickedAt = new Date();

  if (['delivered', 'opened'].includes(this.status)) {
    this.status = 'clicked';
  }

  return this.save();
};

campaignEmailSchema.methods.recordBounce = function (bounceType, bounceReason, bounceCode) {
  this.status = 'bounced';
  this.bouncedAt = new Date();
  this.bounceInfo = {
    bounceType,
    bounceReason,
    bounceCode
  };

  return this.save();
};

campaignEmailSchema.methods.markAsSpam = function () {
  this.status = 'spam';
  return this.save();
};

campaignEmailSchema.methods.recordReply = function () {
  this.status = 'replied';
  this.repliedAt = new Date();
  return this.save();
};

campaignEmailSchema.methods.scheduleRetry = function (delayMinutes = 30) {
  if (this.canRetry) {
    this.retryCount += 1;
    this.nextRetryAt = new Date(Date.now() + (delayMinutes * 60 * 1000));
    this.status = 'pending';
    return this.save();
  }
  throw new Error('Email cannot be retried');
};

campaignEmailSchema.methods.addProviderEvent = function (eventType, eventData) {
  this.providerEvents.push({
    eventType,
    eventData,
    receivedAt: new Date()
  });

  // Keep only last 20 events to prevent document bloat
  if (this.providerEvents.length > 20) {
    this.providerEvents = this.providerEvents.slice(-20);
  }

  return this.save();
};

// Static Methods
campaignEmailSchema.statics.findByCampaign = function (campaignId, filters = {}) {
  return this.find({ campaignId, ...filters })
    .sort({ createdAt: -1 });
};

campaignEmailSchema.statics.getPendingEmails = function (limit = 100) {
  return this.find({
    status: 'pending',
    $or: [
      { scheduledFor: { $lte: new Date() } },
      { scheduledFor: { $exists: false } }
    ]
  })
    .sort({ priority: 1, scheduledFor: 1, createdAt: 1 })
    .limit(limit);
};

campaignEmailSchema.statics.getRetryEmails = function () {
  return this.find({
    status: 'failed',
    retryCount: { $lt: this.maxRetries },
    nextRetryAt: { $lte: new Date() }
  })
    .sort({ nextRetryAt: 1 });
};

campaignEmailSchema.statics.getCampaignStats = async function (campaignId) {
  const stats = await this.aggregate([
    { $match: { campaignId: new mongoose.Types.ObjectId(campaignId) } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);

  const result = {
    total: 0,
    pending: 0,
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    failed: 0
  };

  stats.forEach(stat => {
    result[stat._id] = stat.count;
    result.total += stat.count;
  });

  return result;
};

campaignEmailSchema.statics.getUserEmailStats = async function (userId, dateRange = {}) {
  const matchQuery = { userId };

  if (dateRange.start || dateRange.end) {
    matchQuery.createdAt = {};
    if (dateRange.start) matchQuery.createdAt.$gte = dateRange.start;
    if (dateRange.end) matchQuery.createdAt.$lte = dateRange.end;
  }

  const stats = await this.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: null,
        totalEmails: { $sum: 1 },
        totalOpens: {
          $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$opens', []] } }, 0] }, 1, 0] }
        },
        totalClicks: {
          $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$clicks', []] } }, 0] }, 1, 0] }
        },
        totalBounces: {
          $sum: { $cond: [{ $eq: ['$status', 'bounced'] }, 1, 0] }
        },
        totalCreditsConsumed: { $sum: '$creditsConsumed' }
      }
    }
  ]);

  return stats[0] || {
    totalEmails: 0,
    totalOpens: 0,
    totalClicks: 0,
    totalBounces: 0,
    totalCreditsConsumed: 0
  };
};

// Transform output
campaignEmailSchema.methods.toJSON = function () {
  const email = this.toObject();
  delete email.__v;
  return email;
};

const CampaignEmail = mongoose.model('CampaignEmail', campaignEmailSchema, 'campaign_emails');

module.exports = CampaignEmail;