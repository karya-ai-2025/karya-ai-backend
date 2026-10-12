// models/Membership.js
//
// One row = one person's place in one enterprise organization.
//
// Only enterprise accounts have one. An individual account has no membership
// and no organization, and nothing here is consulted for it.
//
// An invite is a membership too — created with an email and no userId, then
// bound to the account when it is accepted. That way a pending invite is
// visible in the same list as everyone else rather than living somewhere
// separate and getting out of step.

const crypto = require('crypto');
const mongoose = require('mongoose');

const ROLES = ['admin', 'manager', 'employee'];
const STATUSES = ['invited', 'active', 'suspended'];

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const hashToken = (token) =>
  crypto.createHash('sha256').update(String(token)).digest('hex');

const membershipSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },

    // Null while an invite is outstanding — the person has no account yet.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // Who was invited, when userId is not yet known.
    inviteEmail: {
      type: String,
      lowercase: true,
      trim: true,
      default: null,
    },

    // The emailed link carries the plain token; only its hash is stored, so a
    // leaked database row cannot be used to join someone's company.
    inviteTokenHash: { type: String, select: false, index: true },
    inviteExpires: { type: Date },

    role: {
      type: String,
      enum: { values: ROLES, message: 'Role must be admin, manager or employee' },
      required: true,
      default: 'employee',
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

// One account belongs to one organization. Partial, because an outstanding
// invite has no userId and several nulls would otherwise collide.
// Named explicitly so it cannot collide with a plain `userId_1` index left in
// a database by an earlier version of this model.
membershipSchema.index(
  { userId: 1 },
  {
    name: 'one_org_per_user',
    unique: true,
    partialFilterExpression: { userId: { $type: 'objectId' } },
  }
);

// One outstanding invite per email per org, for the same reason.
membershipSchema.index(
  { organizationId: 1, inviteEmail: 1 },
  { unique: true, partialFilterExpression: { inviteEmail: { $type: 'string' } } }
);

/**
 * Issue a fresh invite token. Returns the plain token for the email link;
 * only the hash is kept.
 */
membershipSchema.methods.generateInviteToken = function () {
  const token = crypto.randomBytes(32).toString('hex');
  this.inviteTokenHash = hashToken(token);
  this.inviteExpires = new Date(Date.now() + INVITE_TTL_MS);
  return token;
};

/** The outstanding, unexpired invite a token belongs to, or null. */
membershipSchema.statics.findByInviteToken = function (token) {
  if (!token) return Promise.resolve(null);
  return this.findOne({
    inviteTokenHash: hashToken(token),
    status: 'invited',
    inviteExpires: { $gt: new Date() },
  });
};

/** The active membership for a user, or null. */
membershipSchema.statics.activeForUser = function (userId) {
  return this.findOne({ userId, status: 'active' });
};

membershipSchema.statics.ROLES = ROLES;
membershipSchema.statics.INVITE_TTL_MS = INVITE_TTL_MS;

module.exports = mongoose.model('Membership', membershipSchema);
