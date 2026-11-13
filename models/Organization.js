// models/Organization.js
//
// The company behind every account: a business (buys projects, approves
// work), a partner agency (does the work) or Karya itself (platform). This is
// what lets several people share one plan, one credit pool and the company's
// work, and keep that work when someone leaves.
//
// Every signup creates one or joins one by invitation; there are no accounts
// without an organization.
//
// Who belongs to it, and in what role, lives in Membership.

const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Organization name is required'],
      trim: true,
      minlength: [2, 'Organization name must be at least 2 characters'],
      maxlength: [120, 'Organization name cannot exceed 120 characters'],
    },

    // URL-safe handle. Unique so it can address the org in a path later.
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    // Which side of Karya this organization is on — always the same as its
    // members' account kind. Fixed at creation.
    //   business → buys projects, approves work, pays
    //   partner  → agency / service provider doing the work
    //   platform → Karya's own team
    type: {
      type: String,
      enum: ['business', 'partner', 'platform'],
      required: true,
      immutable: true,
      index: true,
    },

    // ── Partner profile ─────────────────────────────────────────────────
    // What an agency tells businesses about itself. Only used when type is
    // 'partner'. `verified` is Karya's to set (from the console), never the
    // partner's own.
    profile: {
      tagline: { type: String, trim: true, maxlength: 140 },
      description: { type: String, trim: true, maxlength: 2000 },
      website: { type: String, trim: true, maxlength: 200 },
      location: { type: String, trim: true, maxlength: 120 },
      teamSize: { type: String, enum: ['1', '2-10', '11-50', '51-200', '200+'] },
      services: [{ type: String, trim: true, maxlength: 60 }],
      verified: { type: Boolean, default: false },
      completedAt: { type: Date },   // set once the required fields are filled
    },

    settings: {
      // A business normally doesn't build campaigns itself — a partner or the
      // Karya team does, and the business reviews and approves. Karya can turn
      // this on for a business that should build its own campaigns too.
      selfServe: { type: Boolean, default: false },
    },

    // ── The owning account ──────────────────────────────────────────────
    // The admin who created the organization. The company's plan, credits,
    // purchased projects and business profile are held on this account, and
    // every member is resolved to it when those are looked up — which is how
    // the whole team draws on one pool without re-keying the billing data.
    //
    // This membership can never be demoted, suspended or removed.
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ['active', 'suspended'],
      default: 'active',
      index: true,
    },

    billingEmail: {
      type: String,
      lowercase: true,
      trim: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

organizationSchema.index({ name: 'text' });

/**
 * Build a unique slug from a name.
 * Retries with a numeric suffix rather than failing on a duplicate, because
 * two customers called "Acme" is ordinary, not an error.
 */
organizationSchema.statics.buildSlug = async function (name) {
  const base = String(name || 'company')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'company';

  let slug = base;
  let n = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await this.exists({ slug })) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
};

module.exports = mongoose.model('Organization', organizationSchema);
