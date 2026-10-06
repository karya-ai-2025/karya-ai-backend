// Purchase guard — buying projects, upgrading plans, and buying credits.
//
// ⚠️  TEMPORARY — TESTING MODE: PURCHASES ARE OPEN ⚠️
//
// These flows were closed because they currently grant everything for FREE —
// there is no live payment gateway behind them. They are open again so the
// whole buy → own → use path can be tested end to end.
//
// While purchases are enabled:
//   • Anyone can acquire a project without paying
//   • Anyone can upgrade their plan without paying
//   • Anyone can add credits without paying
//
// ── TO CLOSE PURCHASES AGAIN ──────────────────────────────────────────────
//   Set  PURCHASES_ENABLED=false  in the environment (Azure App Settings /
//   .env) and restart — no code change needed. Then do the same on the
//   frontend: NEXT_PUBLIC_PURCHASES_ENABLED=false and rebuild.
//   (karya-ai-next/src/lib/purchases.js)
//
//   To restore the original "closed unless explicitly opened" behaviour,
//   change the line below back to  === 'true'.
// ──────────────────────────────────────────────────────────────────────────
//
// Defaults to OPEN for this testing phase. Production must set
// PURCHASES_ENABLED=false until a real payment gateway is wired up.

const purchasesEnabled = () => process.env.PURCHASES_ENABLED !== 'false';

// Route middleware: block a request outright when purchases are disabled.
const blockPurchases = (req, res, next) => {
  if (purchasesEnabled()) return next();
  return res.status(403).json({
    success: false,
    code: 'PURCHASES_DISABLED',
    message: 'Purchases are temporarily unavailable. Please check back soon.',
  });
};

/**
 * Loud startup banner. Free purchases silently surviving into production is
 * exactly the failure this should not have, so it announces itself.
 */
function warnIfPurchasesOpen() {
  if (!purchasesEnabled()) return;
  console.warn(
    '\n' +
    '  ╔══════════════════════════════════════════════════════════════╗\n' +
    '  ║  TESTING MODE — PURCHASES ARE OPEN                           ║\n' +
    '  ║                                                              ║\n' +
    '  ║  Projects, plan upgrades and credits can be acquired for     ║\n' +
    '  ║  FREE — there is no payment gateway behind these flows.      ║\n' +
    '  ║                                                              ║\n' +
    '  ║  Set PURCHASES_ENABLED=false before going live.              ║\n' +
    '  ╚══════════════════════════════════════════════════════════════╝\n'
  );
}

module.exports = { purchasesEnabled, blockPurchases, warnIfPurchasesOpen };
