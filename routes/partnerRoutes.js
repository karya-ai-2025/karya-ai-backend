// routes/partnerRoutes.js
//
// The partner (agency) app's API area: /api/partner/*.
//
// Mounted behind kindGate('partner') in index.js, so a business or Karya
// token is turned away at the door; here every route also needs a signed-in
// partner account (checked against the account itself) with an organization.
// Team management stays in the shared /api/organizations area.

const express = require('express');
const { protect, requireKind } = require('../middleware/authMiddleware');
const { requireOrg, requireCapability } = require('../middleware/orgContext');
const rateLimit = require('express-rate-limit');
const {
  getPartnerHome,
  updatePartnerProfile,
  listClientProjects,
  previewInvite,
  acceptInvite,
  declineInvite,
  acceptById,
  declineById,
  getClientProject,
  setEngagementMembers,
} = require('../controllers/partnerController');

const router = express.Router();

// ── Public: preview an invitation from its join link ────────────────────────
// Before sign-in, so someone without a partner account yet can see who is
// inviting them and to what. Rate-limited: tokens are long and random, but
// there's no reason to let anyone hammer the lookup.
const previewLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
router.get('/invites/:token', previewLimiter, previewInvite);

// ── Everything else: a signed-in partner account with its organization ──────
router.use(protect, requireKind('partner'), requireOrg);

router.get('/me', getPartnerHome);
router.put('/profile', requireCapability('org.manage'), updatePartnerProfile);

// Client projects: invitations waiting, and the projects the agency works on
router.get('/projects', listClientProjects);
router.post('/invites/:token/accept', acceptInvite);
router.post('/invites/:token/decline', declineInvite);
router.post('/engagements/:id/accept', acceptById);
router.post('/engagements/:id/decline', declineById);
router.get('/engagements/:id', getClientProject);
router.put('/engagements/:id/members', setEngagementMembers);

module.exports = router;
