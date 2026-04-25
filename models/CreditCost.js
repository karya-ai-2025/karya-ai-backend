const mongoose = require('mongoose');

const creditCostSchema = new mongoose.Schema(
  {
    // Type of action that consumes credits
    actionType: {
      type: String,
      required: [true, 'Action type is required'],
      unique: true,
      enum: {
        values: ['VIEW_EMAIL', 'VIEW_PHONE', 'DOWNLOAD_LEADS', 'SEND_CAMPAIGN_EMAIL'],
        message: 'Action type must be VIEW_EMAIL, VIEW_PHONE, DOWNLOAD_LEADS, or SEND_CAMPAIGN_EMAIL'
      }
    },

    // Number of credits consumed for this action
    credits: {
      type: Number,
      required: [true, 'Credits value is required'],
      min: [0, 'Credits cannot be negative'],
      max: [1000, 'Credits cannot exceed 1000']
    },

    // Human-readable description of the action
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      maxlength: [200, 'Description cannot exceed 200 characters']
    },

    // Whether this action is currently active
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

// Index for efficient queries
creditCostSchema.index({ actionType: 1, isActive: 1 });

// Static method to get credit cost for an action
creditCostSchema.statics.getCreditCost = async function(actionType) {
  const creditCost = await this.findOne({
    actionType: actionType,
    isActive: true
  });

  if (!creditCost) {
    throw new Error(`Credit cost not found for action: ${actionType}`);
  }

  return creditCost.credits;
};

// Static method to get all active credit costs
creditCostSchema.statics.getAllActiveCosts = function() {
  return this.find({ isActive: true }).sort({ actionType: 1 });
};

const CreditCost = mongoose.model('CreditCost', creditCostSchema);

module.exports = CreditCost;