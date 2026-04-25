const mongoose = require('mongoose');

const emailTemplateSchema = new mongoose.Schema(
  {
    // Basic Template Info
    templateName: {
      type: String,
      required: [true, 'Template name is required'],
      trim: true,
      minlength: [2, 'Template name must be at least 2 characters'],
      maxlength: [100, 'Template name cannot exceed 100 characters']
    },
    description: {
      type: String,
      trim: true,
      maxlength: [300, 'Description cannot exceed 300 characters']
    },

    // User Reference
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true
    },

    // Email Content
    subject: {
      type: String,
      required: [true, 'Email subject is required'],
      trim: true,
      maxlength: [500, 'Subject cannot exceed 500 characters']
    },
    emailBody: {
      type: String,
      required: [true, 'Email body is required'],
      trim: true,
      maxlength: [50000, 'Email body cannot exceed 50,000 characters']
    },

    // Template Type
    templateType: {
      type: String,
      enum: {
        values: ['campaign', 'follow-up', 'welcome', 'newsletter', 'promotional', 'transactional'],
        message: 'Template type must be campaign, follow-up, welcome, newsletter, promotional, or transactional'
      },
      default: 'campaign',
      index: true
    },

    // Available Variables for Personalization
    availableVariables: [{
      variable: {
        type: String,
        required: true,
        trim: true
      },
      description: {
        type: String,
        required: true,
        trim: true
      },
      example: {
        type: String,
        trim: true
      },
      isRequired: {
        type: Boolean,
        default: false
      }
    }],

    // Template Settings
    settings: {
      contentType: {
        type: String,
        enum: ['html', 'text', 'both'],
        default: 'html'
      },
      trackOpens: {
        type: Boolean,
        default: true
      },
      trackClicks: {
        type: Boolean,
        default: true
      },
      enableUnsubscribe: {
        type: Boolean,
        default: true
      }
    },

    // Template Categories/Tags
    category: {
      type: String,
      enum: {
        values: ['sales', 'marketing', 'support', 'onboarding', 'follow-up', 'general'],
        message: 'Category must be sales, marketing, support, onboarding, follow-up, or general'
      },
      default: 'general',
      index: true
    },

    tags: [{
      type: String,
      trim: true,
      maxlength: 50
    }],

    // Template Status
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    isPublic: {
      type: Boolean,
      default: false
    },

    // Usage Statistics
    usageStats: {
      timesUsed: {
        type: Number,
        default: 0,
        min: 0
      },
      lastUsedAt: Date,
      averageOpenRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
      },
      averageClickRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
      }
    },

    // Template Version Control
    version: {
      type: Number,
      default: 1,
      min: 1
    },
    previousVersions: [{
      version: Number,
      subject: String,
      emailBody: String,
      modifiedAt: {
        type: Date,
        default: Date.now
      },
      changeNote: String
    }],

    // Preview and Testing
    previewData: {
      sampleSubject: String, // Subject with sample variables filled
      sampleBody: String,    // Body with sample variables filled
      generatedAt: Date
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes for better query performance
emailTemplateSchema.index({ userId: 1, category: 1 });
emailTemplateSchema.index({ templateType: 1, isActive: 1 });
emailTemplateSchema.index({ tags: 1 });
emailTemplateSchema.index({ createdAt: -1 });
emailTemplateSchema.index({ 'usageStats.timesUsed': -1 });

// Virtual properties
emailTemplateSchema.virtual('wordCount').get(function () {
  if (!this.emailBody) return 0;
  // Remove HTML tags and count words
  const textOnly = this.emailBody.replace(/<[^>]*>/g, ' ');
  return textOnly.trim().split(/\s+/).filter(word => word.length > 0).length;
});

emailTemplateSchema.virtual('hasVariables').get(function () {
  const variablePattern = /\{[^}]+\}/g;
  return variablePattern.test(this.subject || '') || variablePattern.test(this.emailBody || '');
});

emailTemplateSchema.virtual('variablesInContent').get(function () {
  const variablePattern = /\{([^}]+)\}/g;
  const subjectMatches = [...((this.subject || '').matchAll(variablePattern) || [])];
  const bodyMatches = [...((this.emailBody || '').matchAll(variablePattern) || [])];

  const allVariables = [
    ...subjectMatches.map(match => match[1]),
    ...bodyMatches.map(match => match[1])
  ];

  return [...new Set(allVariables)]; // Remove duplicates
});

// Pre-save middleware
emailTemplateSchema.pre('save', function () {
  // Auto-detect variables in content
  if (this.isModified('subject') || this.isModified('emailBody')) {
    const detectedVariables = this.variablesInContent;

    // Add new variables to availableVariables if they don't exist
    detectedVariables.forEach(variable => {
      const existingVar = this.availableVariables.find(av => av.variable === `{${variable}}`);
      if (!existingVar) {
        this.availableVariables.push({
          variable: `{${variable}}`,
          description: `Auto-detected variable: ${variable}`,
          example: this.getExampleForVariable(variable),
          isRequired: false
        });
      }
    });

    // Generate preview with sample data
    this.generatePreview();
  }

  // Increment version if content changed (but not on first save)
  if (!this.isNew && (this.isModified('subject') || this.isModified('emailBody'))) {
    // Save previous version
    this.previousVersions.push({
      version: this.version,
      subject: this.subject,
      emailBody: this.emailBody,
      changeNote: 'Auto-saved version'
    });

    // Keep only last 10 versions
    if (this.previousVersions.length > 10) {
      this.previousVersions = this.previousVersions.slice(-10);
    }

    this.version += 1;
  }
});

// Instance Methods
emailTemplateSchema.methods.getExampleForVariable = function (variable) {
  const examples = {
    'firstName': 'John',
    'lastName': 'Smith',
    'fullName': 'John Smith',
    'company': 'Microsoft',
    'jobTitle': 'Software Engineer',
    'industry': 'Technology',
    'location': 'New York',
    'email': 'john@company.com',
    'phone': '+1-555-0123'
  };

  return examples[variable] || `[${variable}]`;
};

emailTemplateSchema.methods.generatePreview = function () {
  let sampleSubject = this.subject || '';
  let sampleBody = this.emailBody || '';

  // Replace variables with sample data
  this.variablesInContent.forEach(variable => {
    const placeholder = `{${variable}}`;
    const example = this.getExampleForVariable(variable);

    sampleSubject = sampleSubject.replace(new RegExp(placeholder, 'g'), example);
    sampleBody = sampleBody.replace(new RegExp(placeholder, 'g'), example);
  });

  this.previewData = {
    sampleSubject,
    sampleBody,
    generatedAt: new Date()
  };
};

emailTemplateSchema.methods.personalizeContent = function (leadData) {
  let personalizedSubject = this.subject || '';
  let personalizedBody = this.emailBody || '';

  // Replace variables with actual lead data
  Object.keys(leadData).forEach(key => {
    const placeholder = `{${key}}`;
    const value = leadData[key] || '';

    personalizedSubject = personalizedSubject.replace(new RegExp(placeholder, 'g'), value);
    personalizedBody = personalizedBody.replace(new RegExp(placeholder, 'g'), value);
  });

  return {
    subject: personalizedSubject,
    body: personalizedBody
  };
};

emailTemplateSchema.methods.incrementUsage = function () {
  this.usageStats.timesUsed += 1;
  this.usageStats.lastUsedAt = new Date();
  return this.save();
};

emailTemplateSchema.methods.updatePerformanceStats = function (openRate, clickRate) {
  // Calculate running average
  const currentUsage = this.usageStats.timesUsed;
  if (currentUsage > 0) {
    this.usageStats.averageOpenRate =
      ((this.usageStats.averageOpenRate * (currentUsage - 1)) + openRate) / currentUsage;
    this.usageStats.averageClickRate =
      ((this.usageStats.averageClickRate * (currentUsage - 1)) + clickRate) / currentUsage;
  }

  return this.save();
};

emailTemplateSchema.methods.createVersion = function (changeNote = '') {
  // Save current version to history
  this.previousVersions.push({
    version: this.version,
    subject: this.subject,
    emailBody: this.emailBody,
    changeNote: changeNote || 'Manual version save'
  });

  this.version += 1;
  return this.save();
};

// Static Methods
emailTemplateSchema.statics.findByUser = function (userId, filters = {}) {
  const query = { userId, isActive: true, ...filters };

  return this.find(query)
    .sort({ 'usageStats.timesUsed': -1, updatedAt: -1 });
};

emailTemplateSchema.statics.findByCategory = function (category, userId = null) {
  const query = { category, isActive: true };
  if (userId) query.userId = userId;

  return this.find(query)
    .sort({ 'usageStats.timesUsed': -1, createdAt: -1 });
};

emailTemplateSchema.statics.findPopular = function (limit = 10) {
  return this.find({ isActive: true, 'usageStats.timesUsed': { $gt: 0 } })
    .sort({ 'usageStats.timesUsed': -1 })
    .limit(limit);
};

emailTemplateSchema.statics.searchTemplates = function (searchTerm, userId = null) {
  const searchRegex = new RegExp(searchTerm, 'i');
  const query = {
    isActive: true,
    $or: [
      { templateName: searchRegex },
      { description: searchRegex },
      { subject: searchRegex },
      { tags: { $in: [searchRegex] } }
    ]
  };

  if (userId) query.userId = userId;

  return this.find(query)
    .sort({ 'usageStats.timesUsed': -1, createdAt: -1 });
};

// Transform output
emailTemplateSchema.methods.toJSON = function () {
  const template = this.toObject();
  delete template.__v;
  return template;
};

const EmailTemplate = mongoose.model('EmailTemplate', emailTemplateSchema, 'email_templates');

module.exports = EmailTemplate;