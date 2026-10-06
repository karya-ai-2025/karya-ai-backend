// routes/organizationRoutes.js
//
// Organization context for the signed-in user.
//
// This first slice is read-only plus a preference change. It does not alter
// how any existing endpoint behaves — it only lets the frontend find out
// which companies someone belongs to and what they may do, so navigation can
// be rendered correctly before the rest is wired up.

const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/authMiddleware');
const { attachOrgContext, requireOrg, requireCapability } = require('../middleware/orgContext');
const {
  getMyOrganizations,
  switchOrganization,
  listMembers,
  getCurrentOrganization,
} = require('../controllers/organizationController');

router.use(protect, attachOrgContext);

// Works even with no org yet — reports hasNoOrganization instead of failing,
// so a brand-new or not-yet-migrated account gets a usable answer.
router.get('/me', getMyOrganizations);

router.post('/switch', switchOrganization);

// From here on an org must be resolved.
router.get('/current', requireOrg, getCurrentOrganization);
router.get('/:id/members', requireOrg, requireCapability('members.view'), listMembers);

module.exports = router;
