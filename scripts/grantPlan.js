/**
 * Manually provision a plan for a user who has none.
 * Runs locally against MONGODB_URI in .env — NO deploy, NO server code change.
 *
 * Mirrors what controllers/planController.js createUserPlan/upgrade does, except the
 * end date is chosen here instead of derived from the package billing cycle.
 * Credits come from the package (planPackage.credits) — this script never invents credits.
 *
 * Usage:
 *   node scripts/grantPlan.js <email> <planPackageId> <years>          # dry run
 *   node scripts/grantPlan.js <email> <planPackageId> <years> --yes    # apply
 */

require('dotenv').config();
const mongoose = require('mongoose');

const User        = require('../models/User');
const UserPlan    = require('../models/UserPlan');
const Plan        = require('../models/Plan');
const PlanPackage = require('../models/PlanPackage');

const [, , emailArg, pkgArg, yearsArg, ...flags] = process.argv;
const CONFIRM = flags.includes('--yes');

function bail(msg) { console.error(`\n  ${msg}\n`); process.exit(1); }

(async () => {
  if (!emailArg || !pkgArg) bail('Usage: node scripts/grantPlan.js <email> <planPackageId> <years> [--yes]');

  const years = parseInt(yearsArg || '1', 10);
  if (Number.isNaN(years) || years < 1) bail('<years> must be a whole number >= 1');

  const uri = process.env.MONGODB_URI;
  if (!uri) bail('MONGODB_URI is not set in .env');
  console.log(`\n  Database : ${uri.replace(/\/\/[^@]*@/, '//<hidden>@')}`);

  await mongoose.connect(uri);
  try {
    const user = await User.findOne({ email: emailArg.toLowerCase().trim() });
    if (!user) bail(`No user found with email "${emailArg}"`);
    console.log(`  User     : <${user.email}>  [${user._id}]`);

    // Refuse to stack a second plan on top of a live one.
    const existing = await UserPlan.findOne({ userId: user._id, status: 'active', endDate: { $gt: new Date() } });
    if (existing) {
      bail(`This user already has an active plan (${existing._id}, expires ${existing.endDate.toISOString().slice(0,10)}).\n` +
           '   Use scripts/addCredits.js to top up instead of creating a second plan.');
    }

    const planPackage = await PlanPackage.findById(pkgArg);
    if (!planPackage) bail(`No PlanPackage with _id "${pkgArg}"`);
    const plan = await Plan.findById(planPackage.planId);
    if (!plan) bail(`PlanPackage ${pkgArg} points at a missing Plan ${planPackage.planId}`);

    const startDate = new Date();
    const endDate   = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + years);

    console.log(`  Plan     : ${plan.name} / ${planPackage.name}  [${planPackage._id}]`);
    console.log(`  Credits  : ${planPackage.credits}   Projects: ${planPackage.projectsAvailable}`);
    console.log(`  Window   : ${startDate.toISOString().slice(0,10)}  ->  ${endDate.toISOString().slice(0,10)}  (${years}y)`);

    if (!CONFIRM) {
      console.log('\n  DRY RUN — nothing written. Re-run with --yes to apply.\n');
      return;
    }

    const userPlan = new UserPlan({
      userId: user._id,
      planId: plan._id,
      planPackageId: planPackage._id,
      status: 'active',
      purchaseDate: startDate,
      startDate,
      endDate,
      nextBillingDate: null,
      creditsUsed: 0,
      totalCredits: planPackage.credits || 0,
      projectsCreated: 0,
      paymentDetails: {
        amount: 0,                    // granted internally, not sold
        currency: planPackage.currency || 'USD',
        paymentMethod: 'manual',
        transactionId: `MANUAL_GRANT_${Date.now()}_${user._id.toString().slice(-6)}`,
      },
    });

    await userPlan.save();

    console.log(`\n  DONE. UserPlan ${userPlan._id} created.`);
    console.log(`  totalCredits=${userPlan.totalCredits} creditsUsed=0 remaining=${userPlan.totalCredits}`);
    console.log(`  transaction=${userPlan.paymentDetails.transactionId}\n`);
  } finally {
    await mongoose.connection.close();
  }
})().catch((err) => { console.error('\n  FAILED:', err.message, '\n'); process.exit(1); });
