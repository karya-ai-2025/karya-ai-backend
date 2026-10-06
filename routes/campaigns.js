const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { attachOrgContext } = require('../middleware/orgContext');
const {
  getCampaigns,
  getCampaign,
  createCampaign,
  validateCampaignEmails,
  duplicateCampaign,
  updateCampaign,
  deleteCampaign,
  startCampaign,
  pauseCampaign,
  getCampaignStats,
  getCampaignResults,
  sendCampaignFollowUp,
  getDashboardData
} = require('../controllers/campaignController');

// Apply authentication middleware to all routes
router.use(protect);

// Resolve which organization the caller is acting in, and verify they are a
// member of it. Attaches req.membership / req.organizationId, which
// tenantFilter() reads.
//
// Harmless while ORG_SCOPING is off: it resolves context but nothing uses it
// to filter, so these routes behave exactly as before. It does NOT reject a
// user who has no organization yet — requireOrg does that, and it is not
// applied here until the migration has run.
router.use(attachOrgContext);

// Campaign CRUD routes
router.route('/')
  .get(getCampaigns)      // GET /api/campaigns - Get all campaigns
  .post(createCampaign);  // POST /api/campaigns - Create new campaign

// Dashboard route (before /:id to avoid conflicts)
router.get('/dashboard', getDashboardData); // GET /api/campaigns/dashboard

// Email validation route (before /:id to avoid conflicts)
router.post('/validate-emails', validateCampaignEmails); // POST /api/campaigns/validate-emails

// Individual campaign routes
router.route('/:id')
  .get(getCampaign)       // GET /api/campaigns/:id - Get single campaign
  .put(updateCampaign)    // PUT /api/campaigns/:id - Update campaign
  .delete(deleteCampaign); // DELETE /api/campaigns/:id - Delete campaign

// Campaign action routes
router.post('/:id/duplicate', duplicateCampaign); // POST /api/campaigns/:id/duplicate - Copy campaign as draft
router.post('/:id/start', startCampaign);   // POST /api/campaigns/:id/start - Start campaign
router.post('/:id/pause', pauseCampaign);   // POST /api/campaigns/:id/pause - Pause campaign

// Campaign statistics
router.get('/:id/stats', getCampaignStats); // GET /api/campaigns/:id/stats - Get campaign stats

// Campaign results (per-recipient: who opened) + follow-up/reminder to a segment
router.get('/:id/results', getCampaignResults);      // GET  /api/campaigns/:id/results
router.post('/:id/follow-up', sendCampaignFollowUp);  // POST /api/campaigns/:id/follow-up

module.exports = router;
