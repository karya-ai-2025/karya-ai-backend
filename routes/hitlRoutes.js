const express = require('express');
const { protect, restrictTo } = require('../middleware/authMiddleware');
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
router.post('/', protect, createHitlRequest);
router.get('/', protect, getHitlRequests);
router.get('/:id', protect, getHitlRequest);
router.patch('/:id/status', protect, updateHitlStatus);

module.exports = router;
