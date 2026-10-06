// config/testingFlags.js
//
// ⚠️  TEMPORARY — TESTING MODE ⚠️
//
// The paywall is switched OFF so the full flow can be exercised end to end
// without buying a project or topping up credits.
//
// While BYPASS_PAYWALL is true:
//   • Campaigns start without an active plan, and without enough credits
//   • Email validation runs without a credit check
//   • Follow-up rounds send without a credit check
//   • Every workspace tab is unlocked, whatever the user has bought
//
// Credits are still DEDUCTED whenever the user actually has a plan — only the
// blocking is skipped. So a funded account still behaves exactly as it will in
// production, and the numbers stay honest.
//
// ── TO RESTORE THE PAYWALL ────────────────────────────────────────────────
//   Set BYPASS_PAYWALL=false in the environment (no redeploy of code needed),
//   or flip the default below to `=== 'true'`.
//   Then do the same on the frontend: see
//   karya-ai-next/src/lib/testingFlags.js
// ──────────────────────────────────────────────────────────────────────────
//
// Defaults to ON, because that is what this testing phase needs. Production
// must set BYPASS_PAYWALL=false.

const BYPASS_PAYWALL = process.env.BYPASS_PAYWALL !== 'false';

// ── Organization scoping ────────────────────────────────────────────────
//
// OFF by default, and it must stay off until the migration has run.
//
// While off, every controller filters by userId exactly as it always has —
// the organization code is present but dormant, so nothing changes for
// anyone. New records still get stamped with organizationId when one is
// known, so data created in the meantime is already correct.
//
// While on, queries filter by organizationId and a member's role decides
// what they can see. Flipping this before every record is stamped would
// make existing campaigns, templates and lead lists vanish from view.
//
// ── TO TURN ON, IN ORDER ─────────────────────────────────────────────────
//   1. node scripts/migrateToOrganizations.js            (dry run)
//   2. node scripts/migrateToOrganizations.js --apply
//   3. node scripts/migrateToOrganizations.js --verify   (expect 0 missing)
//   4. ORG_SCOPING=true in the environment, restart
// ─────────────────────────────────────────────────────────────────────────
const ORG_SCOPING = process.env.ORG_SCOPING === 'true';

/**
 * Loud startup banner. A silently-disabled paywall is exactly the kind of
 * thing that survives into production unnoticed, so it announces itself.
 */
function warnIfBypassing() {
  if (!BYPASS_PAYWALL) return;
  console.warn(
    '\n' +
    '  ╔══════════════════════════════════════════════════════════════╗\n' +
    '  ║  TESTING MODE — PAYWALL DISABLED                             ║\n' +
    '  ║                                                              ║\n' +
    '  ║  Campaigns can start with no plan and no credits.            ║\n' +
    '  ║  All workspace tabs are unlocked.                            ║\n' +
    '  ║                                                              ║\n' +
    '  ║  Set BYPASS_PAYWALL=false before going live.                 ║\n' +
    '  ╚══════════════════════════════════════════════════════════════╝\n'
  );
}

module.exports = { BYPASS_PAYWALL, ORG_SCOPING, warnIfBypassing };
