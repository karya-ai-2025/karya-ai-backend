const mongoose = require('mongoose');

const platformPaymentsOrderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    paymentType: {
      type: String,
      enum: ['plan_package'],
      required: true,
      index: true
    },
    payload: {
      planId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Plan'
      },
      planPackageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PlanPackage'
      }
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      default: 'USD'
    },
    gateway: {
      type: String,
      enum: ['cashfree'],
      default: 'cashfree'
    },
    cashfreeOrderId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true
    },
    cashfreeCfOrderId: {
      type: String,
      trim: true
    },
    paymentSessionId: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'expired', 'cancelled'],
      default: 'pending',
      index: true
    },
    fulfilled: {
      type: Boolean,
      default: false,
      index: true
    },
    fulfilledAt: {
      type: Date,
      default: null
    },
    userPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserPlan',
      default: null
    },
    gatewayOrderResponse: {
      type: mongoose.Schema.Types.Mixed
    },
    gatewayVerifyResponse: {
      type: mongoose.Schema.Types.Mixed
    },
    errorMessage: {
      type: String,
      trim: true
    }
  },
  {
    timestamps: true,
    collection: 'platform_payments_orders'
  }
);

platformPaymentsOrderSchema.index({ userId: 1, createdAt: -1 });
platformPaymentsOrderSchema.index({ cashfreeOrderId: 1, userId: 1 });

const PlatformPaymentsOrder = mongoose.model(
  'PlatformPaymentsOrder',
  platformPaymentsOrderSchema
);

module.exports = PlatformPaymentsOrder;
