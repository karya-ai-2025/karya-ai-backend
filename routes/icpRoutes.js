const express = require('express');
const {
  listMyICPs,
  getICPForCampaign,
  reviewICP,
  adminListICPs,
  adminListCampaigns,
  adminCreateICP,
  adminUpdateICP,
  adminArchiveICP,
} = require('../controllers/icpController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

// Everything here requires a signed-in user.
router.use(protect);

// ── Admin routes ──────────────────────────────────────────────────────────────
// Declared BEFORE /:campaignId so "admin" is never parsed as a campaign id.
router.get('/admin/list', restrictTo('admin'), adminListICPs);
// All customers' campaigns, so the admin can pick one to attach an ICP to.
router.get('/admin/campaigns', restrictTo('admin'), adminListCampaigns);
router.post('/admin/:campaignId', restrictTo('admin'), adminCreateICP);
router.put('/admin/:campaignId', restrictTo('admin'), adminUpdateICP);
router.delete('/admin/:campaignId', restrictTo('admin'), adminArchiveICP);

// ── Customer routes ───────────────────────────────────────────────────────────
/**
 * @route GET /api/icp
 * @desc  Every ICP for the signed-in customer's own campaigns
 */
router.get('/', listMyICPs);

/**
 * @route GET /api/icp/:campaignId
 * @desc  The ICP for one of the customer's own campaigns
 */
router.get('/:campaignId', getICPForCampaign);

/**
 * @route PATCH /api/icp/:campaignId/review
 * @desc  Approve the ICP, or send a suggestion back to the admin
 * @body  { action: 'approve' } | { action: 'request_changes', note }
 */
router.patch('/:campaignId/review', reviewICP);

module.exports = router;
