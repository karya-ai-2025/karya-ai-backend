// models/AuditEvent.js
//
// One row = one meaningful thing someone did: who did it, from which
// organization, on whose data, and through which relationship.
//
// Once partners and the Karya team work inside a business's projects, "who
// changed this?" has three possible answers, and the business is owed the
// right one. Rows are append-only: nothing in the app updates or deletes them.

const mongoose = require('mongoose');

const auditEventSchema = new mongoose.Schema(
  {
    // Who acted, and from which organization
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    actorOrgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },

    // How they were allowed to act on this data:
    //   owner    → a member of the organization that owns it
    //   partner  → an agency working on it for the owner (later step)
    //   platform → the Karya team
    //   system   → a background job, no person
    via: {
      type: String,
      enum: ['owner', 'partner', 'platform', 'system'],
      required: true,
    },

    // The organization whose data this is — what a business filters its log by
    tenantOrgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },

    // The purchased project it happened in, if any — a project's Activity tab
    projectInstanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectUser', default: null },

    // Dotted verb, e.g. 'org.created', 'member.invited', 'campaign.approved'
    action: { type: String, required: true, index: true },

    target: {
      type: { type: String },                  // 'Organization', 'Membership', 'Campaign' …
      id: { type: mongoose.Schema.Types.ObjectId },
    },

    // A short, human-readable line plus any small detail worth keeping
    summary: { type: String, trim: true, maxlength: 500 },
    details: { type: mongoose.Schema.Types.Mixed },

    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditEventSchema.index({ tenantOrgId: 1, createdAt: -1 });
auditEventSchema.index({ projectInstanceId: 1, createdAt: -1 });

module.exports = mongoose.model('AuditEvent', auditEventSchema);
