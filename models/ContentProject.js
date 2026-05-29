const mongoose = require('mongoose');
const { Schema } = mongoose;

const linkedinPostSchema = new Schema({
  weekNumber:     { type: Number },
  hookLine:       { type: String },
  body:           { type: String },
  cta:            { type: String },
  hashtags:       [{ type: String }],
  characterCount: { type: Number },
  imageUrl:       { type: String },
}, { _id: false });

const newsletterSchema = new Schema({
  subjectLine: { type: String },
  previewText: { type: String },
  body:        { type: String },
  wordCount:   { type: Number },
  imageUrl:    { type: String },
}, { _id: false });

const contentVersionSchema = new Schema({
  versionNumber: { type: Number, default: 1 },
  generatedBy:   { type: String },
  generatedAt:   { type: Date, default: Date.now },
  adminNotes:    { type: String },
  linkedinPosts: [linkedinPostSchema],
  newsletter:    { type: newsletterSchema },
  isApproved:    { type: Boolean, default: false },
  approvedAt:    { type: Date },
  approvedBy:    { type: Schema.Types.ObjectId, ref: 'User' },
});

const approvalHistorySchema = new Schema({
  action:        { type: String, enum: ['approved', 'rejected', 'revision_requested', 'delivered'] },
  performedBy:   { type: Schema.Types.ObjectId, ref: 'User' },
  performedAt:   { type: Date, default: Date.now },
  note:          { type: String },
  versionNumber: { type: Number },
}, { _id: false });

const contentProjectSchema = new Schema({
  userId:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
  catalogId: { type: Schema.Types.ObjectId, ref: 'ProjectCatalog' },

  status: {
    type: String,
    enum: ['intake_pending', 'in_review', 'generating', 'admin_review',
           'draft_ready', 'revision_requested', 'approved', 'delivered'],
    default: 'intake_pending',
  },

  // Month this content batch is for — "2026-05"
  month: { type: String },

  // User-submitted intake form
  intake: {
    companyName:     { type: String, trim: true },
    industry:        { type: String, trim: true },
    targetAudience:  { type: String, trim: true },
    brandVoice:      { type: String, enum: ['professional', 'casual', 'thought-leader', 'storytelling', 'educational'] },
    keyTopics:       [{ type: String }],
    competitors:     { type: String, trim: true },
    goals:           { type: String, trim: true },
    additionalNotes: { type: String, trim: true },
    submittedAt:     { type: Date },
  },

  // Generated content versions (never overwritten, always appended)
  contentVersions: [contentVersionSchema],

  // Approval / revision history log
  approvalHistory: [approvalHistorySchema],

  // Admin-assigned expert or team member
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },

  adminNotes:  { type: String },
  deliveredAt: { type: Date },

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Latest content version virtual
contentProjectSchema.virtual('latestVersion').get(function () {
  if (!this.contentVersions || this.contentVersions.length === 0) return null;
  return this.contentVersions[this.contentVersions.length - 1];
});

contentProjectSchema.index({ userId: 1, status: 1 });
contentProjectSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('ContentProject', contentProjectSchema);
