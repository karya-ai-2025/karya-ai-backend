// models/Organization.js
//
// The company. This is the tenant — the thing that OWNS campaigns, templates,
// lead lists, the plan and the credits.
//
// Until now everything was owned by an individual User, so three people from
// the same company were three unrelated islands. An Organization is what lets
// them share work, share one credit pool, and keep that work when someone
// leaves.
//
// A User is NOT tied to one Organization. The link lives in Membership, so one
// person can belong to several — an expert working for three clients has three
// memberships and one account.

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

    // ── Personal orgs ───────────────────────────────────────────────────
    // Every existing user gets one of these at migration so nothing breaks:
    // a company of one, with them as Owner. The flag lets the UI stay quiet
    // about "your organization" until there is actually more than one person.
    isPersonal: {
      type: Boolean,
      default: false,
      index: true,
    },

    // ── Domain auto-join ────────────────────────────────────────────────
    // Only domains proven to belong to this company, the same way a sending
    // domain is proven. Empty by default; auto-join stays off until an Owner
    // turns it on, because a shared domain (gmail.com) would let strangers in.
    verifiedDomains: [{
      type: String,
      lowercase: true,
      trim: true,
    }],

    autoJoinOnVerifiedDomain: {
      type: Boolean,
      default: false,
    },

    status: {
      type: String,
      enum: ['active', 'suspended'],
      default: 'active',
      index: true,
    },

    // Denormalised from BusinessProfile at migration so the org is readable
    // on its own. The profile stays the source of truth.
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
organizationSchema.index({ verifiedDomains: 1 });

/**
 * Build a unique slug from a name.
 * Retries with a numeric suffix rather than failing on a duplicate, because
 * two customers called "Acme" is ordinary, not an error.
 */
organizationSchema.statics.buildSlug = async function (name) {
  const base = String(name || 'workspace')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'workspace';

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
