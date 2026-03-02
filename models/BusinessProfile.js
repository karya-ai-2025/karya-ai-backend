// models/BusinessProfile.js
// Business Owner Profile - linked to User account

const mongoose = require('mongoose');

const businessProfileSchema = new mongoose.Schema(
  {
    // ============================================
    // LINK TO USER
    // ============================================
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true // One business profile per user
    },

    // ============================================
    // COMPANY INFORMATION
    // ============================================
    company: {
      name: {
        type: String,
        required: [true, 'Company name is required'],
        trim: true,
        maxlength: [100, 'Company name cannot exceed 100 characters']
      },
      logo: {
        type: String,
        default: null
      },
      website: {
        type: String,
        trim: true,
        match: [
          /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/,
          'Please provide a valid URL'
        ]
      },
      description: {
        type: String,
        maxlength: [1000, 'Description cannot exceed 1000 characters']
      },
      founded: {
        type: Number,
        min: 1800,
        max: new Date().getFullYear()
      }
    },

    // ============================================
    // BUSINESS DETAILS
    // ============================================
    industry: {
      type: String,
      trim: true
    },
    
    companySize: {
      type: String,
      enum: ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+']
    },
    
    annualRevenue: {
      type: String,
      enum: [
        'pre_revenue',
        'under_100k',
        '100k_500k',
        '500k_1m',
        '1m_5m',
        '5m_10m',
        '10m_50m',
        '50m_plus'
      ]
    },
    
    businessType: {
      type: String,
      enum: ['b2b', 'b2c', 'b2b2c', 'd2c', 'marketplace', 'saas', 'other']
    },

    // ============================================
    // LOCATION
    // ============================================
    location: {
      address: String,
      city: String,
      state: String,
      country: {
        type: String,
        default: 'India'
      },
      pincode: String,
      timezone: String
    },

    // ============================================
    // PLATFORM USAGE (from onboarding)
    // ============================================
    platformUsageType: {
      type: String,
      enum: ['single-team', 'agency', 'portfolio', 'personal'],
      default: null
    },

    // ============================================
    // IDEAL CUSTOMER PROFILES (ICPs)
    // ============================================
    idealCustomerProfiles: [{
      name: {
        type: String,
        required: true,
        maxlength: 100
      },
      description: {
        type: String,
        maxlength: 1000
      },
      confirmed: {
        type: Boolean,
        default: false
      },
      createdAt: {
        type: Date,
        default: Date.now
      }
    }],

    // ============================================
    // MARKETING NEEDS
    // ============================================
    marketingGoals: [{
      type: String,
      enum: [
        'brand_awareness',
        'lead_generation',
        'sales_increase',
        'customer_retention',
        'market_expansion',
        'product_launch',
        'reputation_management',
        'social_media_growth',
        'seo_improvement',
        'content_creation'
      ]
    }],
    
    marketingBudget: {
      monthly: {
        type: String
      },
      currency: {
        type: String,
        default: 'INR'
      }
    },
    
    // Marketing Activities (from onboarding)
    marketingActivities: {
      currentActivities: {
        type: String,
        maxlength: 2000
      },
      desiredPlan: {
        type: String,
        maxlength: 2000
      },
      goalsObjectives: {
        type: String,
        maxlength: 2000
      }
    },
    
    currentChallenges: [{
      type: String,
      maxlength: 200
    }],
    
    // Quick Wins (from onboarding)
    quickWins: [{
      type: String,
      maxlength: 200
    }],
    
    targetAudience: {
      demographics: String,
      locations: [String],
      interests: [String],
      ageRange: {
        min: Number,
        max: Number
      }
    },

    // ============================================
    // TEAM & ACCESS
    // ============================================
    team: [{
      email: String,
      name: String,
      role: {
        type: String,
        enum: ['admin', 'manager', 'member', 'viewer']
      },
      invitedAt: Date,
      joinedAt: Date,
      status: {
        type: String,
        enum: ['pending', 'active', 'inactive'],
        default: 'pending'
      }
    }],

    // ============================================
    // SUBSCRIPTION & BILLING
    // ============================================
    subscription: {
      plan: {
        type: String,
        enum: ['free', 'starter', 'professional', 'enterprise'],
        default: 'free'
      },
      status: {
        type: String,
        enum: ['active', 'past_due', 'cancelled', 'trialing'],
        default: 'active'
      },
      currentPeriodStart: Date,
      currentPeriodEnd: Date,
      cancelAtPeriodEnd: Boolean,
      stripeCustomerId: String,
      stripeSubscriptionId: String
    },

    // ============================================
    // STATISTICS
    // ============================================
    stats: {
      projectsCreated: { type: Number, default: 0 },
      expertsHired: { type: Number, default: 0 },
      totalSpent: { type: Number, default: 0 },
      activeProjects: { type: Number, default: 0 }
    },

    // ============================================
    // PREFERENCES
    // ============================================
    preferences: {
      preferredExpertise: [String],
      preferredLanguages: [String],
      communicationPreference: {
        type: String,
        enum: ['email', 'phone', 'chat', 'video'],
        default: 'email'
      },
      availabilityHours: {
        start: String,
        end: String,
        timezone: String
      }
    },

    // ============================================
    // VERIFICATION
    // ============================================
    verification: {
      isVerified: { type: Boolean, default: false },
      gstNumber: String,
      panNumber: String,
      documents: [{
        type: { type: String },
        url: String,
        uploadedAt: Date,
        status: {
          type: String,
          enum: ['pending', 'verified', 'rejected']
        }
      }]
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// ============================================
// INDEXES
// ============================================
businessProfileSchema.index({ 'company.name': 'text' });
businessProfileSchema.index({ industry: 1 });
businessProfileSchema.index({ 'location.city': 1 });
businessProfileSchema.index({ 'subscription.plan': 1 });

// ============================================
// VIRTUALS
// ============================================

// Get profile completion percentage
businessProfileSchema.virtual('completionPercentage').get(function() {
  const fields = [
    this.company?.name,
    this.company?.website,
    this.company?.description,
    this.industry,
    this.companySize,
    this.location?.city,
    this.marketingGoals?.length > 0,
    this.marketingBudget?.monthly,
    this.targetAudience?.demographics
  ];
  
  const completed = fields.filter(Boolean).length;
  return Math.round((completed / fields.length) * 100);
});

// ============================================
// METHODS
// ============================================

// Add team member
businessProfileSchema.methods.addTeamMember = async function(memberData) {
  this.team.push({
    ...memberData,
    invitedAt: new Date(),
    status: 'pending'
  });
  await this.save();
  return this.team[this.team.length - 1];
};

// Remove team member
businessProfileSchema.methods.removeTeamMember = async function(email) {
  this.team = this.team.filter(member => member.email !== email);
  await this.save();
};

// Update subscription
businessProfileSchema.methods.updateSubscription = async function(planData) {
  this.subscription = { ...this.subscription, ...planData };
  await this.save();
};

const BusinessProfile = mongoose.model('BusinessProfile', businessProfileSchema);

module.exports = BusinessProfile;