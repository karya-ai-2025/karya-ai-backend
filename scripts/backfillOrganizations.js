/**
 * One-time fix after the platform restructure: give every account that was
 * created before organizations existed its own organization, with the user as
 * admin. Exactly what signup does now (services/organizationSetup.js).
 *
 * Without this, `protect` answers 403 on every request for those accounts.
 *
 * Skips:
 *   - accounts that already have any membership (active, invited or suspended),
 *     so someone who was removed from an organization stays removed
 *   - accounts that already point at an organization
 *   - Karya admins (isAdmin), which protect already lets through
 *
 * Accounts from before account kinds existed have no `kind` saved; they are
 * set to 'business' first (the schema default for every new account).
 *
 * Usage:
 *   node scripts/backfillOrganizations.js                 # dry run: lists who would be fixed
 *   node scripts/backfillOrganizations.js --yes           # apply
 *   node scripts/backfillOrganizations.js --check <email> # explain one account's access
 */

require('dotenv').config();
const mongoose = require('mongoose');

const User = require('../models/User');
const BusinessProfile = require('../models/BusinessProfile');
const Membership = require('../models/Membership');
const { foundOrganization } = require('../services/organizationSetup');

const CONFIRM = process.argv.includes('--yes');
const checkIdx = process.argv.indexOf('--check');
const CHECK_EMAIL = checkIdx > -1 ? String(process.argv[checkIdx + 1] || '').toLowerCase().trim() : null;

async function explain(email) {
  const Organization = require('../models/Organization');
  const raw = await User.collection.findOne({ email });
  if (!raw) { console.log(`No user with email ${email}`); return; }
  console.log(`User ${email}`);
  console.log(`  kind saved:      ${raw.kind ?? '(none)'}`);
  console.log(`  isAdmin:         ${!!raw.isAdmin}`);
  console.log(`  organizationId:  ${raw.organizationId ?? '(none)'}`);
  const ms = await Membership.find({ userId: raw._id }).lean();
  if (!ms.length) console.log('  memberships:     (none)');
  for (const m of ms) {
    const org = await Organization.findById(m.organizationId).select('name type status').lean();
    console.log(`  membership:      role=${m.role} status=${m.status} org=${org ? `"${org.name}" type=${org.type} status=${org.status}` : '(organization missing)'}`);
  }
}

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI is not set in .env'); process.exit(1); }
  console.log(`\nDatabase: ${uri.replace(/\/\/[^@]*@/, '//<hidden>@')}`);
  console.log(CONFIRM ? 'Mode: APPLY\n' : 'Mode: DRY RUN (add --yes to apply)\n');

  await mongoose.connect(uri);
  try {
    if (CHECK_EMAIL) { await explain(CHECK_EMAIL); return; }

    const withMembership = await Membership.distinct('userId');
    const users = await User.find({
      _id: { $nin: withMembership },
      $or: [{ organizationId: null }, { organizationId: { $exists: false } }],
      isAdmin: { $ne: true },
    });

    if (!users.length) { console.log('Every account already has an organization. Nothing to do.'); return; }

    let fixed = 0, failed = 0;
    for (let user of users) {
      const profile = await BusinessProfile.findOne({ user: user._id }).select('company.name').lean();
      const name = (profile?.company?.name || user.fullName || user.email.split('@')[0]).trim();
      console.log(`${CONFIRM ? 'Fixing ' : 'Would fix'}  ${user.email}  (${user.kind || 'no kind -> business'})  -> org "${name}"`);
      if (!CONFIRM) continue;
      try {
        if (!user.kind) {
          // `kind` is immutable on the model, so write it straight to the collection.
          await User.collection.updateOne({ _id: user._id }, { $set: { kind: 'business' } });
          user = await User.findById(user._id);
        }
        await foundOrganization(user, name);
        await user.save({ validateBeforeSave: false });
        fixed += 1;
      } catch (err) {
        failed += 1;
        console.error(`   FAILED for ${user.email}: ${err.message}`);
      }
    }

    console.log(`\n${users.length} account(s) without an organization.`);
    if (CONFIRM) console.log(`Fixed: ${fixed}   Failed: ${failed}`);
  } finally {
    await mongoose.disconnect();
  }
})().catch((err) => { console.error(err); process.exit(1); });
