// scripts/migrateToOrganizations.js
//
// Gives every existing user an Organization of their own and stamps
// organizationId onto the records they already own.
//
//   node scripts/migrateToOrganizations.js            ← DRY RUN (default)
//   node scripts/migrateToOrganizations.js --apply    ← actually writes
//   node scripts/migrateToOrganizations.js --verify   ← report only
//
// ── Safety ──────────────────────────────────────────────────────────────
// This script NEVER deletes and NEVER overwrites. It only:
//   • creates Organization documents that do not exist
//   • creates Membership documents that do not exist
//   • sets organizationId on records where it is currently missing
//
// Re-running it is safe: everything is keyed on "does this already exist?",
// so a second run finds nothing to do. Nothing is removed at any point, and
// userId is left untouched on every record.
//
// After it runs, each existing user is alone in a personal organization and
// the product behaves exactly as before — the change is invisible until a
// second person is invited.

require('dotenv').config();
const mongoose = require('mongoose');

const User = require('../models/User');
const Organization = require('../models/Organization');
const Membership = require('../models/Membership');
const BusinessProfile = require('../models/BusinessProfile');

// Records that belong to whoever created them. Each is stamped with the
// organizationId of its userId's personal org.
const OWNED_MODELS = [
  ['Campaign',              require('../models/Campaign')],
  ['CampaignEmail',         require('../models/CampaignEmail')],
  ['CampaignICP',           require('../models/CampaignICP')],
  ['EmailTemplate',         require('../models/EmailTemplate')],
  ['UserCRM',               require('../models/UserCRM')],
  ['UserPlan',              require('../models/UserPlan')],
  ['UserCreditConsumption', require('../models/UserCreditConsumption')],
  ['ProjectUser',           require('../models/ProjectUser')],
];

const APPLY  = process.argv.includes('--apply');
const VERIFY = process.argv.includes('--verify');

const log = (...a) => console.log(...a);
const pad = (s, n = 24) => String(s).padEnd(n);

/** A readable org name for a user, preferring their real company name. */
async function orgNameFor(user) {
  // BusinessProfile links to the account through `user`, not `userId` —
  // unlike almost every other model here. Querying userId silently matched
  // nothing and named every organization after its owner instead of their
  // company, which is exactly the kind of miss a "0 of 24 matched" check
  // catches and a successful-looking run does not.
  const profile = await BusinessProfile.findOne({ user: user._id })
    .select('company.name')
    .lean()
    .catch(() => null);

  const companyName = profile && profile.company && profile.company.name
    ? String(profile.company.name).trim()
    : '';

  if (companyName) return companyName;

  const first = String(user.fullName || '').trim().split(/\s+/)[0];
  return first ? `${first}'s workspace` : `Workspace ${String(user._id).slice(-6)}`;
}

async function verify() {
  log('\n── Current state ───────────────────────────────────────────');
  const users = await User.countDocuments();
  const orgs = await Organization.countDocuments();
  const memberships = await Membership.countDocuments();
  log(`  users                 : ${users}`);
  log(`  organizations         : ${orgs}`);
  log(`  memberships           : ${memberships}`);

  const withoutMembership = await User.countDocuments({
    _id: { $nin: await Membership.distinct('userId', { userId: { $ne: null } }) },
  });
  log(`  users with NO org     : ${withoutMembership}`);

  log('\n── Records missing organizationId ──────────────────────────');
  let totalMissing = 0;
  for (const [name, Model] of OWNED_MODELS) {
    const total = await Model.countDocuments();
    const missing = await Model.countDocuments({
      $or: [{ organizationId: { $exists: false } }, { organizationId: null }],
    });
    totalMissing += missing;
    const flag = missing === 0 ? 'ok' : 'todo';
    log(`  ${pad(name)} ${String(missing).padStart(6)} / ${String(total).padStart(6)}   ${flag}`);
  }
  log(`\n  total still to stamp  : ${totalMissing}`);
  return { totalMissing, withoutMembership };
}

async function migrate() {
  log(APPLY
    ? '\n*** APPLYING — writing to the database ***'
    : '\n--- DRY RUN — nothing will be written (pass --apply to commit) ---');

  // ── 1. An organization + owner membership per user ──────────────────
  const users = await User.find().select('_id fullName email lastActiveOrgId').lean();
  log(`\n── Step 1: organizations for ${users.length} users ──────────────`);

  const orgByUser = new Map();
  let created = 0, existing = 0;

  for (const user of users) {
    // Already has a membership? Reuse that org — never make a second.
    const current = await Membership.findOne({ userId: user._id }).lean();
    if (current) {
      orgByUser.set(String(user._id), String(current.organizationId));
      existing += 1;
      continue;
    }

    const name = await orgNameFor(user);

    if (!APPLY) {
      orgByUser.set(String(user._id), `(dry-run org for ${user.email})`);
      created += 1;
      if (created <= 5) log(`    would create: ${pad(name, 34)} owner=${user.email}`);
      continue;
    }

    const slug = await Organization.buildSlug(name);
    const org = await Organization.create({
      name,
      slug,
      isPersonal: true,
      billingEmail: user.email,
      createdBy: user._id,
    });

    await Membership.create({
      organizationId: org._id,
      userId: user._id,
      role: 'owner',
      scope: 'all',
      status: 'active',
      acceptedAt: new Date(),
    });

    // Convenience only — always re-checked against a live membership.
    await User.updateOne({ _id: user._id }, { $set: { lastActiveOrgId: org._id } });

    orgByUser.set(String(user._id), String(org._id));
    created += 1;
  }

  log(`  created: ${created}   already had one: ${existing}`);

  // ── 2. Stamp organizationId onto owned records ──────────────────────
  log(`\n── Step 2: stamping organizationId ─────────────────────────`);

  for (const [name, Model] of OWNED_MODELS) {
    const missing = await Model.find({
      $or: [{ organizationId: { $exists: false } }, { organizationId: null }],
    }).select('_id userId').lean();

    if (!missing.length) { log(`  ${pad(name)} nothing to do`); continue; }

    // Group by org so this is a handful of updateMany calls, not one per doc.
    const byOrg = new Map();
    let orphan = 0;
    for (const doc of missing) {
      const orgId = orgByUser.get(String(doc.userId));
      if (!orgId) { orphan += 1; continue; }   // userId points at a deleted user
      if (!byOrg.has(orgId)) byOrg.set(orgId, []);
      byOrg.get(orgId).push(doc._id);
    }

    let stamped = 0;
    if (APPLY) {
      for (const [orgId, ids] of byOrg) {
        const r = await Model.updateMany(
          { _id: { $in: ids } },
          { $set: { organizationId: orgId } }
        );
        stamped += r.modifiedCount || 0;
      }
    } else {
      stamped = [...byOrg.values()].reduce((s, a) => s + a.length, 0);
    }

    log(`  ${pad(name)} ${APPLY ? 'stamped' : 'would stamp'} ${String(stamped).padStart(6)}`
      + (orphan ? `   (${orphan} skipped: no such user)` : ''));
  }

  if (!APPLY) {
    log('\n--- DRY RUN complete. Nothing was written. ---');
    log('--- Re-run with --apply to commit. ---');
  } else {
    log('\n*** Migration applied. ***');
  }
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  if (VERIFY) {
    await verify();
  } else {
    await verify();
    await migrate();
    if (APPLY) await verify();
  }

  await mongoose.disconnect();
})().catch((err) => {
  console.error('\nMIGRATION ERROR:', err.message);
  process.exit(1);
});
