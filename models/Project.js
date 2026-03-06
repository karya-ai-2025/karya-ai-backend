const mongoose = require('mongoose');
const { Schema } = mongoose;

const projectSchema = new Schema({
  // Basic Project Information
  name: {
    type: String,
    required: [true, 'Project name is required'],
    trim: true,
    maxlength: [100, 'Project name cannot exceed 100 characters']
  },

  slug: {
    type: String,
    unique: true,
    lowercase: true,
    match: [/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens']
  },

  description: {
    type: String,
    required: [true, 'Project description is required'],
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },

  // Project Status & Availability
  status: {
    type: String,
    required: [true, 'Project status is required'],
    enum: {
      values: ['active', 'coming-soon', 'maintenance', 'deprecated'],
      message: 'Status must be one of: active, coming-soon, maintenance, deprecated'
    },
    default: 'active'
  },

  isPublished: {
    type: Boolean,
    default: true
  },

  isFeatured: {
    type: Boolean,
    default: false
  },

  // Media & Assets
  thumbnailImage: {
    type: String, // URL to thumbnail image
    match: [/^https?:\/\/.+/, 'Thumbnail must be a valid URL']
  },

  // Features & Benefits
  features: [{
    type: String,
    required: true,
    maxlength: [200, 'Feature description cannot exceed 200 characters']
  }],

  benefits: [{
    type: String,
    required: true,
    maxlength: [200, 'Benefit description cannot exceed 200 characters']
  }],

  // SEO & Discovery
  tags: [{
    type: String,
    lowercase: true,
    trim: true
  }],

  // Usage tracking
  usageCount: {
    type: Number,
    default: 0
  },

  // Metadata
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  lastUpdatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },

  version: {
    type: String,
    default: '1.0.0'
  }
}, {
  timestamps: true, // Adds createdAt and updatedAt
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
// Note: slug index is automatically created by "unique: true" in field definition
projectSchema.index({ status: 1, isPublished: 1 });
projectSchema.index({ tags: 1 });
projectSchema.index({ createdAt: -1 });
projectSchema.index({ usageCount: -1 });

// Pre-save middleware to generate slug from name if not provided
projectSchema.pre('save', function() {
  if (!this.slug && this.name) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
      .trim('-'); // Remove leading/trailing hyphens
  }
});

// Static method to get active projects
projectSchema.statics.getActiveProjects = function(filters = {}) {
  return this.find({
    status: 'active',
    isPublished: true,
    ...filters
  }).sort({ isFeatured: -1, createdAt: -1 });
};

// Static method to get featured projects
projectSchema.statics.getFeaturedProjects = function(limit = 6) {
  return this.find({
    status: 'active',
    isPublished: true,
    isFeatured: true
  }).limit(limit).sort({ createdAt: -1 });
};

// Instance method to increment usage count
projectSchema.methods.incrementUsage = function() {
  this.usageCount += 1;
  return this.save();
};

module.exports = mongoose.model('Project', projectSchema);
