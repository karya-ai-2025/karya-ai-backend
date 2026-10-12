// routes/organizationRoutes.js
//
// Enterprise organizations: the company, its members and its invitations.
//
// Apart from the public invitation lookup, everything here requires an
// enterprise account (requireOrg) and then a capability for the specific
// action. The organization is always the caller's own — there is no
// organization id in any of these paths.

const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/authMiddleware');
const { requireOrg, requireCapability } = require('../middleware/orgContext');
const { inviteLimiter } = require('../middleware/rateLimiter');
const {
  getMyOrganization,
  updateMyOrganization,
  listMembers,
  inviteMember,
  resendInvite,
  revokeInvite,
  updateMemberRole,
  suspendMember,
  reactivateMember,
  lookupInvite,
} = require('../controllers/organizationController');

// Public: the accept-invite page reads this before the person has an account.
router.get('/invites/lookup/:token', lookupInvite);

router.use(protect, requireOrg);

router.get('/me', getMyOrganization);
router.patch('/me', requireCapability('org.manage'), updateMyOrganization);

router.get('/members', requireCapability('members.view'), listMembers);
router.patch('/members/:id', requireCapability('members.manage'), updateMemberRole);
router.post('/members/:id/suspend', requireCapability('members.manage'), suspendMember);
router.post('/members/:id/reactivate', requireCapability('members.manage'), reactivateMember);

// Invitations send email, so they are rate limited.
router.post('/invites', requireCapability('members.invite'), inviteLimiter, inviteMember);
router.post('/invites/:id/resend', requireCapability('members.invite'), inviteLimiter, resendInvite);
router.delete('/invites/:id', requireCapability('members.invite'), revokeInvite);

module.exports = router;
