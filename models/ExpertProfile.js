// models/ExpertProfile.js
// Expert Profile - linked to User account

const mongoose = require('mongoose');

const expertProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true
    },

    // ============================================
    // PROFESSIONAL INFO (Step 1)
    // ============================================
    headline: {
      type: String,
      trim: true,
      maxlength: [120, 'Headline cannot exceed 120 characters']
    },
    bio: {
      type: String,
      trim: true,
      maxlength: [2000, 'Bio cannot exceed 2000 characters']
    },
    yearsOfExperience: {
      type: Number,
      min: 0,
      max: 50
    },
    communicationStyle: {
      type: String,
      enum: ['Warm', 'Professional', 'Friendly', 'Direct', ''],
      default: ''
    },

    // ============================================
    // CATEGORIES & SKILLS (Step 2)
    // ============================================
    primaryCategory: {
      type: String,
      enum: [
        'Digital Marketing', 'SEO', 'Content Marketing', 'Social Media Marketing',
        'Email Marketing', 'PPC & Paid Ads', 'Branding', 'Marketing Strategy',
        'Growth Hacking', 'PR & Communications', 'Influencer Marketing',
        'Video Marketing', 'Analytics & Data', 'UX/UI Design', 'Web Development',
        'Copywriting', 'Graphic Design', 'E-commerce Marketing', 'Other'
      ]
    },
    secondaryCategories: [{
      type: String,
      enum: [
        'Digital Marketing', 'SEO', 'Content Marketing', 'Social Media Marketing',
        'Email Marketing', 'PPC & Paid Ads', 'Branding', 'Marketing Strategy',
        'Growth Hacking', 'PR & Communications', 'Influencer Marketing',
        'Video Marketing', 'Analytics & Data', 'UX/UI Design', 'Web Development',
        'Copywriting', 'Graphic Design', 'E-commerce Marketing', 'Other'
      ]
    }],

    skills: [{
      name: { type: String },
      level: {
        type: String,
        enum: ['Beginner', 'Intermediate', 'Advanced', 'Expert'],
        default: 'Intermediate'
      }
    }],

    tools: [{
      type: String,
      trim: true
    }],

    industries: [{
      type: String,
      trim: true
    }],

    // ============================================
    // SERVICES (Step 3)
    // ============================================
    services: [{
      name: {
        type: String,
        trim: true,
        maxlength: 200
      },
      description: {
        type: String,
        trim: true,
        maxlength: 1000
      },
      pricingType: {
        type: String,
        enum: ['hourly', 'project', 'monthly', 'custom'],
        default: 'hourly'
      },
      pricing: {
        type: String,
        trim: true
      },
      duration: {
        type: String,
        trim: true
      },
      createdAt: {
        type: Date,
        default: Date.now
      }
    }],

    // ============================================
    // PRICING (Legacy/Summary)
    // ============================================
    pricing: {
      hourlyRate: {
        min: { type: Number, min: 0 },
        max: { type: Number, min: 0 },
        currency: { type: String, default: 'USD' }
      },
      projectRate: {
        min: { type: Number, min: 0 },
        max: { type: Number, min: 0 },
        currency: { type: String, default: 'USD' }
      },
      pricingModel: {
        type: String,
        enum: ['hourly', 'project', 'retainer', 'flexible'],
        default: 'flexible'
      }
    },

    // ============================================
    // AVAILABILITY
    // ============================================
    availability: {
      status: {
        type: String,
        enum: ['available', 'busy', 'unavailable'],
        default: 'available'
      },
      hoursPerWeek: { type: Number, min: 0, max: 80, default: 40 },
      workType: {
        type: String,
        enum: ['full-time', 'part-time', 'contract', 'freelance'],
        default: 'freelance'
      },
      remoteOnly: { type: Boolean, default: true }
    },

    // ============================================
    // LOCATION
    // ============================================
    location: {
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      country: { type: String, trim: true, default: 'India' },
      timezone: { type: String, trim: true }
    },

    // ============================================
    // EDUCATION
    // ============================================
    education: [{
      institution: { type: String, trim: true },
      degree: { type: String, trim: true },
      field: { type: String, trim: true },
      yearFrom: Number,
      yearTo: Number
    }],

    // ============================================
    // CERTIFICATIONS
    // ============================================
    certifications: [{
      name: { type: String, trim: true },
      issuer: { type: String, trim: true },
      issueDate: Date,
      expiryDate: Date,
      credentialUrl: { type: String, trim: true }
    }],

    // ============================================
    // WORK EXPERIENCE
    // ============================================
    experience: [{
      title: { type: String, trim: true },
      company: { type: String, trim: true },
      description: { type: String, trim: true, maxlength: 500 },
      startDate: Date,
      endDate: Date,
      isCurrent: { type: Boolean, default: false }
    }],

    // ============================================
    // PORTFOLIO (Step 4)
    // ============================================
    portfolio: [{
      title: { type: String, trim: true },
      client: { type: String, trim: true },
      description: { type: String, trim: true, maxlength: 1000 },
      results: { type: String, trim: true, maxlength: 500 },
      category: { type: String, trim: true },
      images: [{ type: String }],
      link: { type: String, trim: true },
      attachments: [{
        name: { type: String },
        url: { type: String },
        type: { type: String }
      }],
      createdAt: { type: Date, default: Date.now }
    }],

    // ============================================
    // SOCIAL LINKS (Step 4)
    // ============================================
    socialLinks: {
      linkedin: { type: String, trim: true },
      twitter: { type: String, trim: true },
      website: { type: String, trim: true },
      github: { type: String, trim: true },
      behance: { type: String, trim: true },
      dribbble: { type: String, trim: true },
      portfolio: { type: String, trim: true },
      other: { type: String, trim: true }
    },

    // ============================================
    // RATINGS & REVIEWS
    // ============================================
    ratings: {
      overall: { type: Number, default: 0, min: 0, max: 5 },
      communication: { type: Number, default: 0, min: 0, max: 5 },
      quality: { type: Number, default: 0, min: 0, max: 5 },
      timeliness: { type: Number, default: 0, min: 0, max: 5 },
      totalReviews: { type: Number, default: 0 }
    },

    // ============================================
    // STATS
    // ============================================
    stats: {
      profileViews: { type: Number, default: 0 },
      projectsCompleted: { type: Number, default: 0 },
      totalEarnings: { type: Number, default: 0 },
      repeatClients: { type: Number, default: 0 }
    },

    // ============================================
    // PROFILE STATUS
    // ============================================
    profileStatus: {
      isPublic: { type: Boolean, default: false },
      isSearchable: { type: Boolean, default: false },
      isVerified: { type: Boolean, default: false },
      isFeatured: { type: Boolean, default: false },
      joinedAsExpert: { type: Date, default: Date.now },
      lastActive: { type: Date, default: Date.now }
    },

    // ============================================
    // PAYMENT INFO (kept private)
    // ============================================
    paymentInfo: {
      bankName: { type: String, trim: true },
      accountNumber: { type: String, trim: true },
      ifscCode: { type: String, trim: true },
      upiId: { type: String, trim: true },
      paypalEmail: { type: String, trim: true }
    },

    // ============================================
    // PREFERENCES
    // ============================================
    preferences: {
      showRates: { type: Boolean, default: true },
      allowDirectMessages: { type: Boolean, default: true },
      emailOnNewProject: { type: Boolean, default: true },
      language: { type: String, default: 'English' }
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// ============================================
// VIRTUALS
// ============================================

// Profile completion percentage
expertProfileSchema.virtual('completionPercentage').get(function () {
  const fields = [
    this.headline,
    this.bio,
    this.yearsOfExperience,
    this.primaryCategory,
    this.skills?.length > 0,
    this.services?.length > 0,
    this.pricing?.hourlyRate?.min,
    this.location?.city,
    this.education?.length > 0,
    this.experience?.length > 0,
    this.portfolio?.length > 0
  ];

  const filled = fields.filter(Boolean).length;
  return Math.round((filled / fields.length) * 100);
});

// ============================================
// METHODS
// ============================================

// Check if profile can go public
expertProfileSchema.methods.canGoPublic = function () {
  return !!(
    this.headline &&
    this.bio &&
    this.skills?.length > 0
  );
};

// Add portfolio item
expertProfileSchema.methods.addPortfolioItem = async function (item) {
  this.portfolio.push(item);
  await this.save();
  return this.portfolio[this.portfolio.length - 1];
};

// Add service
expertProfileSchema.methods.addService = async function (service) {
  this.services.push(service);
  await this.save();
  return this.services[this.services.length - 1];
};

// ============================================
// INDEXES
// ============================================
expertProfileSchema.index({ primaryCategory: 1 });
expertProfileSchema.index({ 'skills.name': 1 });
expertProfileSchema.index({ 'availability.status': 1 });
expertProfileSchema.index({ 'ratings.overall': -1 });
expertProfileSchema.index({ 'profileStatus.isPublic': 1, 'profileStatus.isSearchable': 1 });
expertProfileSchema.index(
  { headline: 'text', bio: 'text', 'skills.name': 'text', primaryCategory: 'text' },
  { name: 'expert_search_index' }
);

const ExpertProfile = mongoose.model('ExpertProfile', expertProfileSchema);

module.exports = ExpertProfile;