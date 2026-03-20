const mongoose = require('mongoose');

const planPackageSchema = new mongoose.Schema(
  {
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plan',
      required: [true, 'Plan ID is required']
    },
    name: {
      type: String,
      required: [true, 'Package name is required'],
      trim: true
    },
    // Pricing information
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative']
    },
    // Credits system
    credits: {
      type: Number,
      required: [true, 'Credits are required'],
      min: [0, 'Credits cannot be negative']
    },
    // Project limitations
    projectsAvailable: {
      type: Number,
      required: [true, 'Projects available is required'],
      min: [1, 'At least 1 project must be available']
    },
    // Support information
    support: {
      type: String,
      trim: true
    },

    // Package status
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Index for better query performance
planPackageSchema.index({ planId: 1, isActive: 1 });

// Static method to get packages by plan
planPackageSchema.statics.findByPlan = function(planId) {
  return this.find({
    planId: planId,
    isActive: true
  });
};

const PlanPackage = mongoose.model('PlanPackage', planPackageSchema, 'planpackages');

module.exports = PlanPackage;