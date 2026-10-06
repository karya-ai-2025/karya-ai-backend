const mongoose = require('mongoose');

/**
 * Ideal Customer Profile — one per campaign.
 *
 * Created by an admin on behalf of a customer, then reviewed by that customer:
 * the customer either approves it or writes a suggestion, which sends it back to
 * the admin. A campaign cannot start sending until its ICP is approved.
 *
 * The `filters` block deliberately mirrors the fields accepted by
 * POST /api/leads/generate, so an approved ICP can be executed directly as a
 * lead search instead of being re-typed.
 */

const icpFiltersSchema = new mongoose.Schema(
  {
    industry:        [{ type: String, trim: true }],
    location:        [{ type: String, trim: true }],
    seniority:       [{ type: String, trim: true }],
    segment:         [{ type: String, trim: true }],
    companySegment:  [{ type: String, trim: true }],
    company:         [{ type: String, trim: true }],
  },
  { _id: false }
);

const campaignICPSchema = new mongoose.Schema(
  {
    // ── Ownership ───────────────────────────────────────────────────────────
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: [true, 'Campaign is required'],
      unique: true,          // exactly one ICP per campaign
      index: true,
    },

    // Denormalised from Campaign.userId so the customer's list query needs no join.
    // Kept in sync by the controller — campaigns do not change hands.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
      index: true,
    },
    // ── Tenant ───────────────────────────────────────────────────────────
    // Which ORGANIZATION owns this record. userId above stays, but now means
    // "who created it" rather than "who owns it" — queries scope on this.
    //
    // Optional for now so existing records stay readable during migration;
    // tightened to required once every document is backfilled.
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true
    },

    // ── Content ─────────────────────────────────────────────────────────────
    name: {
      type: String,
      required: [true, 'ICP name is required'],
      trim: true,
      maxlength: [120, 'ICP name cannot exceed 120 characters'],
    },

    // The customer's ask in their own words — context for the admin, not executable.
    summary: {
      type: String,
      trim: true,
      maxlength: [2000, 'Summary cannot exceed 2000 characters'],
      default: '',
    },

    // Executable targeting — feeds the leads search.
    filters: {
      type: icpFiltersSchema,
      default: () => ({}),
    },

    // ── The email sequence ──────────────────────────────────────────────────
    // A campaign is never a single send. Four emails go out in order, each to a
    // different slice of the audience based on what happened to the one before:
    //
    //   1. initial    -> everyone
    //   2. follow_up  -> those who OPENED the first one
    //   3. recall     -> those who did NOT open it
    //   4. final      -> everyone still not replied ("final call")
    //
    // All four are approved together, so the customer signs off on the whole
    // conversation rather than just the opening line.
    sequence: [{
      step:    { type: Number, required: true, min: 1, max: 10 },
      key:     { type: String, enum: ['initial', 'follow_up', 'recall', 'final'], required: true },
      label:   { type: String, trim: true },
      subject: { type: String, trim: true, maxlength: 300, default: '' },
      body:    { type: String, maxlength: 20000, default: '' },
      // Who receives this step. Maps to the segments campaignController already
      // uses for follow-up rounds, so the sequence is executable as-is.
      audience: {
        type: String,
        enum: ['all', 'opened', 'not_opened', 'not_replied'],
        default: 'all',
      },
      // Wait after the previous step before sending this one.
      delayHours: { type: Number, default: 48, min: 0, max: 2160 },
    }],

    // ── Review loop ─────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: {
        values: ['draft', 'awaiting_user', 'approved', 'revision_requested', 'archived'],
        message: 'Invalid ICP status',
      },
      default: 'draft',
      index: true,
    },

    customerNote: { type: String, trim: true, maxlength: 2000, default: '' }, // customer → admin
    adminNote:    { type: String, trim: true, maxlength: 2000, default: '' }, // admin → customer

    revisionCount: { type: Number, default: 0, min: 0 },

    // Full back-and-forth history. Without this the original ask is lost by round three.
    revisions: [{
      name:         { type: String, trim: true },
      summary:      { type: String, trim: true },
      filters:      { type: icpFiltersSchema, default: () => ({}) },
      customerNote: { type: String, trim: true, default: '' },
      adminNote:    { type: String, trim: true, default: '' },
      at:           { type: Date, default: Date.now },
    }],

    // ── Audit ───────────────────────────────────────────────────────────────
    createdByAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt:     { type: Date },
    sentForReviewAt:{ type: Date },

    // ── Auto-approval ───────────────────────────────────────────────────────
    // A campaign must not sit blocked forever waiting on a customer who never
    // replies. When an ICP is sent for review we set a deadline; once it passes,
    // the ICP counts as approved and the campaign is free to send.
    //
    // Only applies while status is 'awaiting_user'. An ICP the customer HAS
    // responded to ('revision_requested') never auto-approves — they engaged and
    // asked for changes, so the ball is with the admin, not the clock.
    autoApproveAt: { type: Date, index: true },

    // How the approval happened, so the record is honest about it.
    approvalSource: {
      type: String,
      enum: ['customer', 'auto'],
      default: undefined,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

campaignICPSchema.index({ userId: 1, status: 1 });
campaignICPSchema.index({ status: 1, updatedAt: -1 }); // admin queue ordering

/**
 * The four steps every campaign sends, in order, with sensible defaults.
 * Used to seed a new ICP so the admin edits copy rather than inventing structure,
 * and to backfill an ICP saved before the sequence existed.
 */
campaignICPSchema.statics.defaultSequence = function () {
  return [
    {
      step: 1, key: 'initial', label: 'First email',
      audience: 'all', delayHours: 0,
      subject: '', body: '',
    },
    {
      step: 2, key: 'follow_up', label: 'Follow-up (they opened it)',
      audience: 'opened', delayHours: 48,
      subject: '', body: '',
    },
    {
      step: 3, key: 'recall', label: 'Recall (they did not open it)',
      audience: 'not_opened', delayHours: 48,
      subject: '', body: '',
    },
    {
      step: 4, key: 'final', label: 'Final call',
      audience: 'not_replied', delayHours: 96,
      subject: '', body: '',
    },
  ];
};

/** Human wording for who a step goes to — shown to the customer. */
campaignICPSchema.statics.AUDIENCE_LABELS = {
  all: 'Everyone on the list',
  opened: 'Only those who opened the previous email',
  not_opened: 'Only those who did not open the previous email',
  not_replied: 'Everyone who has not replied yet',
};

/**
 * Each step maps to a segment the campaign controller already understands, so
 * an approved sequence can be executed with the existing follow-up machinery.
 */
campaignICPSchema.statics.AUDIENCE_TO_SEGMENT = {
  all: 'all',
  opened: 'opened',
  not_opened: 'not-opened',
  not_replied: 'all',
};

/**
 * How long a customer has to respond before the ICP approves itself.
 * Override with ICP_AUTO_APPROVE_HOURS; defaults to 24.
 */
campaignICPSchema.statics.autoApproveHours = function () {
  const raw = parseInt(process.env.ICP_AUTO_APPROVE_HOURS || '', 10);
  return Number.isInteger(raw) && raw > 0 ? raw : 24;
};

/** The deadline for an ICP sent for review right now. */
campaignICPSchema.statics.nextAutoApproveAt = function (from = new Date()) {
  return new Date(from.getTime() + this.autoApproveHours() * 60 * 60 * 1000);
};

/**
 * Has the response window closed on an ICP still awaiting the customer?
 * Used by the send gate so a campaign is never blocked by a passed deadline,
 * even if the background sweep hasn't run yet.
 */
campaignICPSchema.statics.isPastDeadline = function (icp) {
  if (!icp || icp.status !== 'awaiting_user' || !icp.autoApproveAt) return false;
  return icp.autoApproveAt.getTime() <= Date.now();
};

// True once approved — by the customer, or by the deadline passing.
// This is what gates campaign sending.
campaignICPSchema.virtual('isApproved').get(function () {
  return this.status === 'approved';
});

/** Whole hours left for the customer to respond; 0 once the window has closed. */
campaignICPSchema.virtual('hoursUntilAutoApprove').get(function () {
  if (this.status !== 'awaiting_user' || !this.autoApproveAt) return null;
  const ms = this.autoApproveAt.getTime() - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / (60 * 60 * 1000));
});

// Waiting on the admin to act (customer asked for changes).
campaignICPSchema.virtual('needsAdminAttention').get(function () {
  return this.status === 'revision_requested';
});

/**
 * Push the current state into revisions[] before overwriting it.
 * Call this from the admin update path, before applying new values.
 */
campaignICPSchema.methods.snapshot = function () {
  this.revisions.push({
    name:         this.name,
    summary:      this.summary,
    filters:      this.filters,
    customerNote: this.customerNote,
    adminNote:    this.adminNote,
    at:           new Date(),
  });

  // Keep history bounded so the document cannot grow without limit.
  if (this.revisions.length > 30) {
    this.revisions = this.revisions.slice(-30);
  }
};

/** Shape the filters into the body POST /api/leads/generate expects. */
campaignICPSchema.methods.toLeadFilters = function () {
  const f = this.filters || {};
  const out = {};
  for (const key of ['industry', 'location', 'seniority', 'segment', 'companySegment', 'company']) {
    if (Array.isArray(f[key]) && f[key].length > 0) out[key] = f[key];
  }
  return out;
};

// Tenant-scoped lookups — every org-scoped query starts with organizationId.
campaignICPSchema.index({ organizationId: 1, status: 1 });

module.exports = mongoose.model('CampaignICP', campaignICPSchema, 'campaign_icps');
