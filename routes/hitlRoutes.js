const express = require('express');
const { protect, restrictTo } = require('../middleware/authMiddleware');
const { requireCapability } = require('../middleware/orgContext');
const { projectContext } = require('../middleware/projectContext');
const {
  createHitlRequest,
  getHitlRequests,
  getHitlRequest,
  updateHitlStatus,
  adminListRequests,
  adminUpdateRequest,
  regenerateRequest
} = require('../controllers/hitlController');

const router = express.Router();

// Admin (expert) routes — declared before '/:id' so they don't get shadowed.
router.get('/admin/list', protect, restrictTo('admin'), adminListRequests);
router.patch('/admin/:id', protect, restrictTo('admin'), adminUpdateRequest);
router.post('/admin/:id/regenerate', protect, restrictTo('admin'), regenerateRequest);

// User routes
// Inside a project, requests are created in and limited to it
router.post('/', protect, projectContext, createHitlRequest);
router.get('/', protect, projectContext, getHitlRequests);
router.get('/:id', protect, projectContext, getHitlRequest);
// Accepting or rejecting reviewed emails is a sign-off, so it needs campaign.approve
router.patch('/:id/status', protect, projectContext, requireCapability('campaign.approve'), updateHitlStatus);

module.exports = router;
