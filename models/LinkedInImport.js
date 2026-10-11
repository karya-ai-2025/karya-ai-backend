// models/LinkedInImport.js
// Raw LinkedIn data a member chose to share through the Member Data Portability
// API, kept exactly as LinkedIn returned it so new fields can be mapped later
// without asking the member to authorize again. One document per user; a new
// import replaces the previous one.

const mongoose = require('mongoose');

const linkedInImportSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true
    },
    importedAt: { type: Date, default: Date.now },

    // { PROFILE: [ {...} ], POSITIONS: [ {...}, … ], … } — snapshotData rows per domain
    domains: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Row count per domain, and the domains LinkedIn could not serve this time
    counts: { type: mongoose.Schema.Types.Mixed, default: {} },
    failedDomains: [{ _id: false, domain: String, reason: String }],

    // What the import added to the expert profile
    applied: {
      experience: { type: Number, default: 0 },
      education: { type: Number, default: 0 },
      certifications: { type: Number, default: 0 },
      skills: { type: Number, default: 0 },
      fields: [{ type: String }]
    }
  },
  { timestamps: true, minimize: false }
);

module.exports = mongoose.model('LinkedInImport', linkedInImportSchema);
