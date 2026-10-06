/**
 * Manually add (or remove) credits on a user's active plan.
 * Runs locally against whatever MONGODB_URI is in .env — NO deploy, NO code change on the server.
 *
 * Usage:
 *   node scripts/addCredits.js <email>                  # dry run: just show current credits
 *   node scripts/addCredits.js <email> <credits>        # preview the change (still a dry run)
 *   node scripts/addCredits.js <email> <credits> --yes  # actually write it
 *
 * Examples:
 *   node scripts/addCredits.js nupoor@acerstone.com
 *   node scripts/addCredits.js nupoor@acerstone.com 500
 *   node scripts/addCredits.js nupoor@acerstone.com 500 --yes
 *
 * Writes exactly what POST /api/credits/purchase writes (controllers/creditController.js):
 *   - userPlan.totalCredits += credits
 *   - a row in paymentDetails.creditPurchases
 *   - paymentDetails.lastCreditPurchase
 * Nothing else is touched. creditsUsed is never modified.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const User     = require('../models/User');
const UserPlan = require('../models/UserPlan');

const [, , emailArg, creditsArg, ...flags] = process.argv;
const CONFIRM = flags.includes('--yes');

function bail(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

(async () => {
  if (!emailArg) bail('Usage: node scripts/addCredits.js <email> [credits] [--yes]');

  const uri = process.env.MONGODB_URI;
  if (!uri) bail('MONGODB_URI is not set in .env');

  const credits = creditsArg === undefined ? null : parseInt(creditsArg, 10);
  if (credits !== null && (Number.isNaN(credits) || credits === 0)) {
    bail('<credits> must be a non-zero whole number (negative removes credits)');
  }

  // Show which database we are about to touch, so nobody edits prod by accident.
  const host = uri.replace(/\/\/[^@]*@/, '//<hidden>@');
  console.log(`\n  Database : ${host}`);

  await mongoose.connect(uri);

  try {
    const user = await User.findOne({ email: emailArg.toLowerCase().trim() });
    if (!user) bail(`No user found with email "${emailArg}"`);

    console.log(`  User     : ${user.name || '(no name)'} <${user.email}>  [${user._id}]`);

    const userPlan = await UserPlan.findOne({
      userId: user._id,
      status: 'active',
      endDate: { $gt: new Date() },
    }).sort({ endDate: -1 });

    if (!userPlan) {
      bail('This user has no active, unexpired plan. Credits live on UserPlan, so there is nothing to add to.\n' +
           '   They need to be on a plan first (or you pick an expired plan and extend its endDate).');
    }

    const before = {
      total: userPlan.totalCredits || 0,
      used:  userPlan.creditsUsed  || 0,
    };
    before.remaining = Math.max(0, before.total - before.used);

    console.log(`  Plan     : ${userPlan._id}  (expires ${userPlan.endDate.toISOString().slice(0, 10)})`);
    console.log(`  Current  : total ${before.total}, used ${before.used}, remaining ${before.remaining}`);

    if (credits === null) {
      console.log('\n  Read-only check. Pass a credit amount to change it.\n');
      return;
    }

    const after = before.total + credits;
    if (after < before.used) {
      bail(`Refusing: that would leave totalCredits (${after}) below creditsUsed (${before.used}).`);
    }

    console.log(`  Change   : ${before.total} ${credits >= 0 ? '+' : '-'} ${Math.abs(credits)} = ${after}  (remaining becomes ${Math.max(0, after - before.used)})`);

    if (!CONFIRM) {
      console.log('\n  DRY RUN — nothing written. Re-run with --yes to apply.\n');
      return;
    }

    const purchaseDate  = new Date();
    const transactionId = `MANUAL_${Date.now()}_${user._id.toString().slice(-6)}`;

    userPlan.totalCredits = after;

    if (!userPlan.paymentDetails.creditPurchases) {
      userPlan.paymentDetails.creditPurchases = [];
    }
    userPlan.paymentDetails.creditPurchases.push({
      amount: 0,                 // granted, not sold
      credits,
      purchaseDate,
      transactionId,
      paymentMethod: 'manual',
      currency: userPlan.paymentDetails.currency || 'USD',
    });
    userPlan.paymentDetails.lastCreditPurchase = {
      amount: 0,
      credits,
      purchaseDate,
      transactionId,
    };

    await userPlan.save();

    console.log(`\n  DONE. totalCredits is now ${userPlan.totalCredits}. Transaction: ${transactionId}\n`);
  } finally {
    await mongoose.connection.close();
  }
})().catch((err) => {
  console.error('\n  FAILED:', err.message, '\n');
  process.exit(1);
});
