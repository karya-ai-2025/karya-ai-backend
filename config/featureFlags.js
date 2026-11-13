// config/featureFlags.js
//
// Product areas that are switched off while the platform is restructured into
// business / partner / Karya accounts. Switched off, not deleted: the code is
// kept and comes back by flipping the flag.
//
// ── EXPERT FLOW ───────────────────────────────────────────────────────────
// Off by default. While off:
//   • Expert signup, login, social sign-in, role switch and create-profile are refused
//   • Any session already signed in as an expert is refused on its next request
//   • /api/expert-onboarding, /api/marketplace and /api/expert-interview answer 403
//   • /api/profiles/expert* and /api/profiles/experts/* answer 403
//   • A catalog project's experts list comes back empty
//   • Demo logins (they are expert accounts) are refused
// Setting EXPERT_FLOW_ENABLED=true reopens the routes and screens, but expert
// accounts as built have no organization, and every account now needs one —
// so experts would still be refused until they are given one (most likely as
// partner organizations of one person, which is where this flow is heading).
// The frontend has a matching flag: src/lib/featureFlags.js
// ──────────────────────────────────────────────────────────────────────────

const { AppError } = require('../middleware/errorHandler');

const EXPERT_FLOW_ENABLED = process.env.EXPERT_FLOW_ENABLED === 'true';

const EXPERT_FLOW_PAUSED_MESSAGE =
  'The expert area of Karya is paused while we upgrade the platform. Please contact support@karya.ai.';

const expertFlowPausedError = () => new AppError(EXPERT_FLOW_PAUSED_MESSAGE, 403);

/** Route guard for anything that only exists for experts. */
const requireExpertFlow = (req, res, next) =>
  EXPERT_FLOW_ENABLED ? next() : next(expertFlowPausedError());

/**
 * Whether this account must be kept out while the expert flow is off: one that
 * is signed in as an expert and has no business profile to fall back to.
 */
const isBlockedExpert = (user) =>
  !EXPERT_FLOW_ENABLED && !!user && user.activeRole === 'expert' && !user.hasOwnerProfile;

/**
 * An account that is signed in as an expert but also has a business profile
 * is moved back to its business side rather than locked out. Returns true when
 * the role was changed, so the caller knows to save.
 */
const moveOffExpertRole = (user) => {
  if (EXPERT_FLOW_ENABLED || !user || user.activeRole !== 'expert' || !user.hasOwnerProfile) return false;
  user.activeRole = 'owner';
  return true;
};

module.exports = {
  EXPERT_FLOW_ENABLED,
  EXPERT_FLOW_PAUSED_MESSAGE,
  expertFlowPausedError,
  requireExpertFlow,
  isBlockedExpert,
  moveOffExpertRole,
};
