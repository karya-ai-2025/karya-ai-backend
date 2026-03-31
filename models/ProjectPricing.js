const mongoose = require('mongoose');
const { Schema } = mongoose;

const projectPricingSchema = new Schema({

  projectId: {
    type: Schema.Types.ObjectId,
    ref: 'ProjectCatalog',
    required: true,
    index: true,
  },

  // Tier identity
  tierId: {
    type: String,
    required: true,
    enum: ['credit', 'bronze', 'silver', 'gold'],
  },

  name:         { type: String, required: true },   // "Silver"
  displayOrder: { type: Number, required: true },   // 1,2,3,4 for sort
  popular:      { type: Boolean, default: false },  // shown as "Recommended"
  badge:        { type: String },                   // "Best Value", "Most Flexible"

  // Pricing
  price: {
    amount:       { type: Number, required: true }, // 0, 15000, 45000 etc.
    currency:     { type: String, default: 'INR' },
    billingCycle: {
      type: String,
      enum: ['one-time', 'monthly', 'per-unit', 'free'],
      default: 'monthly',
    },
    label:        { type: String },  // "₹45,000/mo" — human readable
    note:         { type: String },  // "Uses platform credits", "+ ad spend"
  },

  // Deliverable quantities — numbers that change per tier
  quantities: {
    contacts:           { type: Number },  // leads / contacts delivered
    emailSequences:     { type: Number },  // number of sequences
    postsPerMonth:      { type: Number },  // social posts
    hoursPerWeek:       { type: Number },  // VA hours
    reportsPerMonth:    { type: Number },  // intelligence reports
    candidatesPresented:{ type: Number },  // for ai-matching
    revisionRounds:     { type: Number, default: 2 },
  },

  // Boolean features — what's included
  features: {
    decisionMakerProfiles: { type: Boolean, default: false },
    companyIntelligence:   { type: Boolean, default: false },
    icpScoring:            { type: Boolean, default: false },
    linkedinProfiles:      { type: Boolean, default: false },
    techStackData:         { type: Boolean, default: false },
    crmExport:             { type: Boolean, default: true  },
    emailVerified:         { type: Boolean, default: false },
    abTesting:             { type: Boolean, default: false },
    intentData:            { type: Boolean, default: false },
    dedicatedPM:           { type: Boolean, default: false },
    weeklyReport:          { type: Boolean, default: false },
    replacementGuarantee:  { type: Boolean, default: false },
    prioritySupport:       { type: Boolean, default: false },
  },

  // Support level
  support: {
    type:         { type: String },  // "email", "chat", "priority-chat", "dedicated-pm"
    label:        { type: String },  // "Priority Chat Support"
    responseTime: { type: String },  // "4 hours", "24 hours"
  },

  // What the user receives at the end of this tier
  deliverableSummary: { type: String },  // "300 verified contacts + CRM export"

  isActive: { type: Boolean, default: true },

}, {
  timestamps: true,
});

// Compound index — one tierId per project
projectPricingSchema.index({ projectId: 1, tierId: 1 }, { unique: true });
projectPricingSchema.index({ projectId: 1, displayOrder: 1 });

module.exports = mongoose.model('ProjectPricing', projectPricingSchema);
