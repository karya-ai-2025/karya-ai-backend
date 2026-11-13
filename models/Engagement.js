// models/Engagement.js
//
// One row = one worker (an agency, or a single third-party expert — both are
// partner organizations) brought into ONE of a business's purchased projects.
//
// The only way in is the business inviting them. A worker never browses or
// requests projects. The invitation carries a single-use join link; accepting
// it (signed in as a partner account) makes the engagement active, and from
// then on the worker's team can open that project — that one, nothing else —
// with what `grants` allows.
//
//   invited  → waiting for the worker to accept or decline
//   active   → the worker can work in the project
//   paused   → access suspended by the business; can be resumed
//   declined → the worker said no
//   cancelled→ the business withdrew the invitation before it was accepted
//   ended    → finished for good; all work stays with the business

const crypto = require('crypto');
const mongoose = require('mongoose');

const STATUSES = ['invited', 'active', 'paused', 'declined', 'cancelled', 'ended'];
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const engagementSchema = new mongoose.Schema(
  {
    // ── Whose project ──────────────────────────────────────────────────────
    businessOrgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    projectInstanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectUser', required: true, index: true },
    projectSlug: { type: String, trim: true },

    // ── Who does the work ──────────────────────────────────────────────────
    // Known as soon as the invited email belongs to a partner account, or
    // when the invitation is accepted; null until then.
    partnerOrgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    invitedEmail: { type: String, lowercase: true, trim: true, required: true },

    status: { type: String, enum: STATUSES, default: 'invited', index: true },

    // What the worker may do inside this project. Capability names from
    // config/permissions.js; the business can change them while active.
    grants: [{ type: String }],

    // The worker's people on this project. Their admins and leads can open
    // every engagement of theirs; everyone else only those they're on.
    members: [{
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      addedAt: { type: Date, default: Date.now },
    }],

    message: { type: String, trim: true, maxlength: 1000 },   // from the business, shown with the invitation

    // ── The join link ──────────────────────────────────────────────────────
    // The emailed/copied link carries the plain token; only its hash is kept.
    inviteTokenHash: { type: String, select: false, index: true },
    inviteExpires: { type: Date },

    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    acceptedAt: { type: Date },
    decidedAt: { type: Date },          // declined / cancelled
    pausedAt: { type: Date },
    pausedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    endedAt: { type: Date },
    endedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

engagementSchema.index({ partnerOrgId: 1, status: 1 });
engagementSchema.index({ invitedEmail: 1, status: 1 });

/** Issue a fresh single-use join token; returns the plain token for the link. */
engagementSchema.methods.generateInviteToken = function () {
  const token = crypto.randomBytes(32).toString('hex');
  this.inviteTokenHash = hashToken(token);
  this.inviteExpires = new Date(Date.now() + INVITE_TTL_MS);
  return token;
};

/** The still-open invitation a token belongs to, or null. */
engagementSchema.statics.findByInviteToken = function (token) {
  if (!token || !/^[a-f0-9]{64}$/.test(String(token))) return Promise.resolve(null);
  return this.findOne({
    inviteTokenHash: hashToken(token),
    status: 'invited',
    inviteExpires: { $gt: new Date() },
  });
};

/** Is this user one of the people assigned to the engagement? */
engagementSchema.methods.hasMember = function (userId) {
  return (this.members || []).some((m) => String(m.userId) === String(userId));
};

engagementSchema.statics.STATUSES = STATUSES;
engagementSchema.statics.INVITE_TTL_MS = INVITE_TTL_MS;

module.exports = mongoose.model('Engagement', engagementSchema);
