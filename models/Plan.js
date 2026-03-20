const mongoose = require('mongoose');

const planSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Plan name is required'],
      trim: true,
      unique: true
    },
    type: {
      type: String,
      required: [true, 'Plan type is required'],
      enum: {
        values: ['startups_solopreneurs', 'enterprise'],
        message: 'Plan type must be either startups_solopreneurs or enterprise'
      }
    },
    displayName: {
      type: String,
      required: [true, 'Display name is required'],
      trim: true
    },
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
planSchema.index({ type: 1, isActive: 1 });

// Virtual to get all packages for this plan
planSchema.virtual('packages', {
  ref: 'PlanPackage',
  localField: '_id',
  foreignField: 'planId'
});

// Static method to get plans by type
planSchema.statics.findByType = function(planType) {
  return this.find({
    type: planType,
    isActive: true
  });
};

const Plan = mongoose.model('Plan', planSchema, 'plan');

module.exports = Plan;