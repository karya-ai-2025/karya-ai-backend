const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  startCampaign,
  pauseCampaign,
  getCampaignStats,
  getDashboardData
} = require('../controllers/campaignController');

// Apply authentication middleware to all routes
router.use(protect);

// Campaign CRUD routes
router.route('/')
  .get(getCampaigns)      // GET /api/campaigns - Get all campaigns
  .post(createCampaign);  // POST /api/campaigns - Create new campaign

// Dashboard route (before /:id to avoid conflicts)
router.get('/dashboard', getDashboardData); // GET /api/campaigns/dashboard

// Individual campaign routes
router.route('/:id')
  .get(getCampaign)       // GET /api/campaigns/:id - Get single campaign
  .put(updateCampaign)    // PUT /api/campaigns/:id - Update campaign
  .delete(deleteCampaign); // DELETE /api/campaigns/:id - Delete campaign

// Campaign action routes
router.post('/:id/start', startCampaign);   // POST /api/campaigns/:id/start - Start campaign
router.post('/:id/pause', pauseCampaign);   // POST /api/campaigns/:id/pause - Pause campaign

// Campaign statistics
router.get('/:id/stats', getCampaignStats); // GET /api/campaigns/:id/stats - Get campaign stats

module.exports = router;