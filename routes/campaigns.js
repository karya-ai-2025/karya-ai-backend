const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { requireCapability, requireAnyCapability } = require('../middleware/orgContext');
const { projectContext } = require('../middleware/projectContext');
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
  getDashboardData,
  submitCampaignForApproval,
  approveCampaign,
  rejectCampaign
} = require('../controllers/campaignController');

// Apply authentication middleware to all routes. `protect` also resolves the
// organization and role; requireCapability below holds members to that role.
//
// A business doesn't build campaigns itself (a partner or the Karya team
// does) unless Karya has switched self-serve on for it — so building,
// editing and copying need campaign.create / campaign.edit, which a business
// only holds with self-serve. Viewing, approving and pausing stay with it.
router.use(protect, projectContext);   // which project, if any (middleware/projectContext.js)
// Everything below needs to be able to see campaigns at all — every business
// role can; a worker only if the client granted it.
router.use(requireCapability('campaign.view'));

// Campaign CRUD routes
router.route('/')
  .get(getCampaigns)      // GET /api/campaigns - Get all campaigns
  .post(requireCapability('campaign.create'), createCampaign);  // POST /api/campaigns - Create new campaign

// Dashboard route (before /:id to avoid conflicts)
router.get('/dashboard', getDashboardData); // GET /api/campaigns/dashboard

// Email validation route (before /:id to avoid conflicts)
// Verifying addresses is paid for from the business's credits, so it also needs leads.search
router.post('/validate-emails', requireCapability('campaign.create'), requireCapability('leads.search'), validateCampaignEmails); // POST /api/campaigns/validate-emails

// Individual campaign routes
router.route('/:id')
  .get(getCampaign)       // GET /api/campaigns/:id - Get single campaign
  .put(requireCapability('campaign.edit'), updateCampaign)    // PUT /api/campaigns/:id - Update campaign
  .delete(deleteCampaign); // DELETE /api/campaigns/:id - Delete campaign

// Campaign action routes
router.post('/:id/duplicate', requireCapability('campaign.create'), duplicateCampaign); // POST /api/campaigns/:id/duplicate - Copy campaign as draft
// Start checks the role itself: an employee may start their own campaign once approved.
router.post('/:id/start', startCampaign);   // POST /api/campaigns/:id/start - Start campaign
// Pausing is the emergency stop: whoever can approve or start a campaign can halt it.
router.post('/:id/pause', requireAnyCapability('campaign.start', 'campaign.approve'), pauseCampaign);   // POST /api/campaigns/:id/pause - Pause campaign

// Campaign statistics
router.get('/:id/stats', getCampaignStats); // GET /api/campaigns/:id/stats - Get campaign stats

// Campaign results (per-recipient: who opened) + follow-up/reminder to a segment
router.get('/:id/results', getCampaignResults);      // GET  /api/campaigns/:id/results
router.post('/:id/follow-up', requireCapability('campaign.start'), sendCampaignFollowUp);  // POST /api/campaigns/:id/follow-up

// Approval loop: the builder submits, the business's admin/manager decides
router.post('/:id/submit', requireCapability('campaign.submitForApproval'), submitCampaignForApproval); // POST /api/campaigns/:id/submit
router.post('/:id/approve', requireCapability('campaign.approve'), approveCampaign); // POST /api/campaigns/:id/approve
router.post('/:id/reject', requireCapability('campaign.approve'), rejectCampaign);   // POST /api/campaigns/:id/reject

module.exports = router;
