const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { requireCapability } = require('../middleware/orgContext');
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

// Apply authentication middleware to all routes. For an enterprise account
// `protect` also resolves the organization and role; requireCapability below
// holds members to that role and lets individual accounts straight through.
router.use(protect);

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
// Start checks the role itself: an employee may start their own campaign once approved.
router.post('/:id/start', startCampaign);   // POST /api/campaigns/:id/start - Start campaign
router.post('/:id/pause', pauseCampaign);   // POST /api/campaigns/:id/pause - Pause campaign

// Campaign statistics
router.get('/:id/stats', getCampaignStats); // GET /api/campaigns/:id/stats - Get campaign stats

// Campaign results (per-recipient: who opened) + follow-up/reminder to a segment
router.get('/:id/results', getCampaignResults);      // GET  /api/campaigns/:id/results
router.post('/:id/follow-up', requireCapability('campaign.start'), sendCampaignFollowUp);  // POST /api/campaigns/:id/follow-up

// Approval loop (enterprise): employee submits, manager/admin decides
router.post('/:id/submit', requireCapability('campaign.submitForApproval'), submitCampaignForApproval); // POST /api/campaigns/:id/submit
router.post('/:id/approve', requireCapability('campaign.approve'), approveCampaign); // POST /api/campaigns/:id/approve
router.post('/:id/reject', requireCapability('campaign.approve'), rejectCampaign);   // POST /api/campaigns/:id/reject

module.exports = router;
