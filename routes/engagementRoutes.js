// routes/engagementRoutes.js
//
// /api/engagements — a business bringing a worker (agency / third-party
// expert) into one of its projects. Business accounts only: mounted behind
// kindGate('business') in index.js, and every route needs the company's own
// organization plus the right capability.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, requireKind } = require('../middleware/authMiddleware');
const { requireOrg, requireCapability } = require('../middleware/orgContext');
const {
  inviteWorker,
  listEngagements,
  updateEngagement,
  refreshInviteLink,
} = require('../controllers/engagementController');

const router = express.Router();

// Invitations send email; keep a company from flooding inboxes.
const inviteLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false });

router.use(protect, requireKind('business'), requireOrg);

router.get('/', requireCapability('partners.view'), listEngagements);
router.post('/', requireCapability('partners.manage'), inviteLimiter, inviteWorker);
router.patch('/:id', requireCapability('partners.manage'), updateEngagement);
router.post('/:id/link', requireCapability('partners.manage'), inviteLimiter, refreshInviteLink);

module.exports = router;
