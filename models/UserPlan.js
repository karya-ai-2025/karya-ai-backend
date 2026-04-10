const mongoose = require('mongoose');

const userPlanSchema = new mongoose.Schema(
  {
    // User who purchased the plan
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required']
    },

    // Plan that was purchased
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plan',
      required: [true, 'Plan ID is required']
    },

    // Specific package within the plan
    planPackageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PlanPackage',
      required: [true, 'Plan Package ID is required']
    },

    // Subscription status
    status: {
      type: String,
      enum: {
        values: ['active', 'expired', 'cancelled', 'suspended', 'pending'],
        message: 'Status must be active, expired, cancelled, suspended, or pending'
      },
      default: 'active'
    },

    // Subscription dates
    purchaseDate: {
      type: Date,
      required: [true, 'Purchase date is required'],
      default: Date.now
    },

    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
      default: Date.now
    },

    endDate: {
      type: Date,
      required: [true, 'End date is required']
    },

    // Usage tracking
    creditsUsed: {
      type: Number,
      default: 0,
      min: [0, 'Credits used cannot be negative']
    },

    totalCredits: {
      type: Number,
      default: 0,
      min: [0, 'Total credits cannot be negative']
    },

    projectsCreated: {
      type: Number,
      default: 0,
      min: [0, 'Projects created cannot be negative']
    },

    // Payment information
    paymentDetails: {
      amount: {
        type: Number,
        required: [true, 'Payment amount is required']
      },
      currency: {
        type: String,
        default: 'USD'
      },
      paymentMethod: {
        type: String,
        enum: ['stripe', 'paypal', 'razorpay', 'manual'],
        default: 'stripe'
      },
      transactionId: {
        type: String,
        trim: true
      },
      stripeSubscriptionId: {
        type: String,
        trim: true
      },
      // Credit purchases tracking
      creditPurchases: [{
        amount: {
          type: Number,
          required: true
        },
        credits: {
          type: Number,
          required: true
        },
        purchaseDate: {
          type: Date,
          default: Date.now
        },
        transactionId: {
          type: String,
          required: true
        },
        paymentMethod: {
          type: String,
          default: 'manual'
        },
        currency: {
          type: String,
          default: 'USD'
        }
      }],
      // Quick reference to last credit purchase
      lastCreditPurchase: {
        amount: Number,
        credits: Number,
        purchaseDate: Date,
        transactionId: String
      }
    },

    // Next billing date (for subscriptions)
    nextBillingDate: {
      type: Date
    },

    // Cancellation details
    cancellationDate: {
      type: Date,
      default: null
    },

    cancellationReason: {
      type: String,
      trim: true
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes for better query performance
userPlanSchema.index({ userId: 1, status: 1 });
userPlanSchema.index({ planId: 1 });
userPlanSchema.index({ endDate: 1, status: 1 });
userPlanSchema.index({ nextBillingDate: 1, autoRenew: 1 });

// Virtual to check if plan is currently active and not expired
userPlanSchema.virtual('isCurrentlyActive').get(function() {
  return this.status === 'active' && this.endDate > new Date();
});

// Virtual to get remaining credits
userPlanSchema.virtual('remainingCredits').get(function() {
  return Math.max(0, this.totalCredits - this.creditsUsed);
});

// Virtual to get remaining projects
userPlanSchema.virtual('remainingProjects').get(function() {
  // This would need to be populated with the plan package projects
  return 0; // Placeholder - would calculate from planPackage.projectsAvailable - projectsCreated
});

// Static method to find active plans for a user
userPlanSchema.statics.findActiveByUser = function(userId) {
  return this.find({
    userId: userId,
    status: 'active',
    endDate: { $gt: new Date() }
  }).populate(['planId', 'planPackageId']);
};

// Static method to find expiring plans (within next 7 days)
userPlanSchema.statics.findExpiringSoon = function() {
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);

  return this.find({
    status: 'active',
    endDate: { $lte: nextWeek, $gt: new Date() }
  }).populate(['userId', 'planId', 'planPackageId']);
};

// Instance method to cancel subscription
userPlanSchema.methods.cancelSubscription = function(reason = '') {
  this.status = 'cancelled';
  this.cancellationDate = new Date();
  this.cancellationReason = reason;
  this.autoRenew = false;
  return this.save();
};

// Instance method to check if user can create more projects
userPlanSchema.methods.canCreateProject = function(planPackage) {
  return this.projectsCreated < planPackage.projectsAvailable;
};

// Instance method to check if user has enough credits
userPlanSchema.methods.hasEnoughCredits = function(requiredCredits) {
  const remainingCredits = this.totalCredits - this.creditsUsed;
  return remainingCredits >= requiredCredits;
};

const UserPlan = mongoose.model('UserPlan', userPlanSchema);

module.exports = UserPlan;