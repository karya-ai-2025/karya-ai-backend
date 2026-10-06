// models/Membership.js
//
// One row = one person's place in one company.
//
// This is the join table that makes everything else work. A User has as many
// memberships as they have companies, which is why there is no organizationId
// on User: an expert hired by three clients is one account with three rows.
//
// An invite is a membership too — created with an email and no userId, then
// bound to the account when it is accepted. That way a pending invite is
// visible in the same list as everyone else rather than living somewhere
// separate and getting out of step.

const mongoose = require('mongoose');

const ROLES = ['owner', 'admin', 'member', 'contractor'];
const SCOPES = ['all', 'team', 'own'];
const STATUSES = ['invited', 'active', 'suspended'];

const membershipSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },

    // Null while an invite is outstanding — the person may have no account yet.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    // Who was invited, when userId is not yet known.
    inviteEmail: {
      type: String,
      lowercase: true,
      trim: true,
      default: null,
    },

    role: {
      type: String,
      enum: { values: ROLES, message: 'Role must be owner, admin, member or contractor' },
      required: true,
      default: 'member',
      index: true,
    },

    // Whose records this person can see, within whatever their role allows.
    // 'own' is the safe default for a member; a manager gets 'team' or 'all'.
    // This is what avoids needing a full org chart to answer "can my manager
    // see my campaigns?".
    scope: {
      type: String,
      enum: SCOPES,
      default: 'own',
    },

    // ── Contractors ─────────────────────────────────────────────────────
    // A hired expert is scoped to named campaigns rather than the whole org.
    // Empty for everyone else, and meaningless unless role === 'contractor'.
    campaignIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
    }],

    // Contractors are time-boxed. Null means open-ended.
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },

    status: {
      type: String,
      enum: STATUSES,
      default: 'active',
      index: true,
    },

    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    invitedAt: { type: Date },
    acceptedAt: { type: Date },

    // Set when access is withdrawn. The row is kept rather than deleted, so
    // "who did this?" still resolves on work they left behind.
    suspendedAt: { type: Date },
    suspendedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

// One membership per person per org. Partial, because an outstanding invite
// has no userId and several nulls would otherwise collide.
membershipSchema.index(
  { organizationId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: 'objectId' } } }
);

// One outstanding invite per email per org, for the same reason.
membershipSchema.index(
  { organizationId: 1, inviteEmail: 1 },
  { unique: true, partialFilterExpression: { inviteEmail: { $type: 'string' } } }
);

membershipSchema.index({ userId: 1, status: 1 });

/**
 * A contractor past their end date is no longer active, whether or not a
 * sweep has run. Checked at request time so expiry does not depend on a job.
 */
membershipSchema.methods.isCurrentlyActive = function () {
  if (this.status !== 'active') return false;
  if (this.expiresAt && this.expiresAt.getTime() <= Date.now()) return false;
  return true;
};

/** Every active membership for a user, newest first. */
membershipSchema.statics.forUser = function (userId) {
  return this.find({ userId, status: 'active' })
    .populate('organizationId', 'name slug isPersonal status')
    .sort({ createdAt: 1 });
};

/** The membership binding one user to one org, or null. */
membershipSchema.statics.forUserInOrg = function (userId, organizationId) {
  return this.findOne({ userId, organizationId, status: 'active' });
};

membershipSchema.statics.ROLES = ROLES;
membershipSchema.statics.SCOPES = SCOPES;

module.exports = mongoose.model('Membership', membershipSchema);
