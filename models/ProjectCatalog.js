const mongoose = require('mongoose');
const { Schema } = mongoose;

const projectCatalogSchema = new Schema({
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },

  // Display
  title:       { type: String, required: true, trim: true },
  subtitle:    { type: String, trim: true },
  tagline:     { type: String, trim: true },
  description: { type: String, required: true },
  number:      { type: String },           // e.g. "Project 1.1 – 1.2"
  badge:       { type: String },           // "Most Popular", "Top Rated", etc.
  budgetRange: { type: String },           // e.g. "₹15,000 – ₹75,000"

  // Classification
  category: {
    type: String,
    required: true,
    enum: ['outbound', 'outreach', 'email', 'brand', 'traffic',
           'intelligence', 'relationship', 'assistant', 'ai-matching'],
  },
  difficulty: {
    type: String,
    enum: ['Beginner', 'Intermediate', 'Advanced'],
  },
  duration: { type: String },              // "4–8 weeks", "Ongoing (monthly)"

  // Stage / grouping
  stageNumber:  { type: Number },          // 1, 2, 3 …
  stageName:    { type: String },          // "Awareness", "Conversion", etc.
  projectCode:  { type: String },          // "A-01", "B-03", etc.
  quote:        { type: String },          // Hero pull-quote shown on card

  // Sub-projects / phases
  subProjects: [{ type: String }],

  // Content arrays
  howItWorks:    [{ type: String }],
  deliverables:  [{ type: String }],
  subjects:      [{ type: String }],       // ICP Strategy, Data Research, etc.
  tools:         [{ type: String }],       // Apollo.io, HubSpot, etc.
  expertSkills:  [{ type: String }],
  targetFor:     [{ type: String }],       // Coaches, B2B SaaS, etc.
  matchIndustries: [{ type: String }],

  // Problem + AI/Human split
  businessChallenge:  { type: String },    // The core pain this project solves
  aiWorkflow:         [{ type: String }],  // What the AI does ("Drafts content", "Schedules distribution"…)
  expertEnsures:      [{ type: String }],  // What the expert is responsible for ("Brand voice integrity"…)
  humanApprovalTasks: [{ type: String }],  // Decisions that require human sign-off
  expertProfileDesc:  { type: String },    // Ideal expert background (prose paragraph)

  // Outcomes & success metrics
  outcomes:     [{ type: String }],        // Quantified results ("8–12 pieces/month, 20%+ MoM traffic"…)
  guarantees:   [{ type: String }],        // Promises ("Consistent brand voice"…)
  kpis:         [{ type: String }],        // Tracked metrics ("Organic traffic growth"…)
  pricingModel: { type: String },          // How it's billed ("Per piece + monthly retainer"…)
  roi:          { type: String },          // ROI framing ("1 lead/mo = $3–8K vs $1,200/mo cost")

  // Milestones — ordered delivery checkpoints
  milestones: [{
    label:       { type: String },         // "Week 1", "Month 2", etc.
    description: { type: String },         // "ICP doc + 30-day calendar approved"
  }],

  // Dependencies — prerequisite tools, data, or projects
  dependencies: [{ type: String }],

  // FAQ
  faq: [{
    q: { type: String },
    a: { type: String },
  }],

  // Social proof
  successHighlight: { type: String },
  successROI:       { type: String },
  successStory: {
    company:  { type: String },
    result:   { type: String },
    industry: { type: String },
  },

  // Discovery / ranking stats
  stats: {
    expertCount:    { type: Number, default: 0 },
    completedCount: { type: Number, default: 0 },
    avgRating:      { type: Number, default: 0, min: 0, max: 5 },
    trendingCount:  { type: Number, default: 0 },
    trendingLabel:  { type: String },
    // city → expert count  e.g. { Mumbai: 4, Bangalore: 7 }
    nearbyExpertCount: { type: Map, of: Number, default: {} },
    // industry → match % e.g. { 'B2B SaaS': 95 }
    matchScore:        { type: Map, of: Number, default: {} },
  },

  // UI theme (stored so API can send it to any client)
  theme: {
    gradient:    { type: String },   // "from-blue-500 to-blue-700"
    bgLight:     { type: String },   // "bg-blue-50"
    textColor:   { type: String },   // "text-blue-700"
    borderColor: { type: String },   // "border-blue-200"
  },

  // Experts who have done this type of work
  associatedExperts: [{
    expertId:        { type: mongoose.Schema.Types.ObjectId, ref: 'ExpertProfile' },
    portfolioItemId: { type: mongoose.Schema.Types.ObjectId },
    contribution:    { type: String, trim: true },
    isVerified:      { type: Boolean, default: false },
    addedAt:         { type: Date, default: Date.now },
  }],

  // Expert cities where talent is available
  expertCities: [{ type: String }],

  // Flags
  isFeatured:  { type: Boolean, default: false },
  isTrending:  { type: Boolean, default: false },
  isActive:    { type: Boolean, default: true },
  isPublished: { type: Boolean, default: true },

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Virtual — pricing tiers (populated via ProjectPricing)
projectCatalogSchema.virtual('pricingTiers', {
  ref:          'ProjectPricing',
  localField:   '_id',
  foreignField: 'projectId',
  options:      { sort: { displayOrder: 1 } },
});

projectCatalogSchema.index({ category: 1, isActive: 1 });
projectCatalogSchema.index({ isTrending: 1 });
projectCatalogSchema.index({ isFeatured: 1 });
projectCatalogSchema.index({ 'stats.trendingCount': -1 });

module.exports = mongoose.model('ProjectCatalog', projectCatalogSchema);
