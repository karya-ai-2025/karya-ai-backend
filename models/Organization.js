// models/Organization.js
//
// The company behind an enterprise account. This is what lets several people
// share campaigns, templates, lead lists, one plan and one credit pool, and
// keep that work when someone leaves.
//
// Only enterprise signups create one. Individual accounts have no
// organization at all and keep owning their data by userId.
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
