const express = require('express');
const {
  getCreditStats,
  getCreditHistory,
  getCreditRecord,
  getCreditSummary,
  purchaseCredits
} = require('../controllers/creditController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// All credit routes require authentication
router.use(protect);

/**
 * @route GET /api/credits/stats
 * @desc Get user's credit consumption statistics
 * @access Private
 * @params {string} startDate - Start date for filtering (ISO string)
 * @params {string} endDate - End date for filtering (ISO string)
 */
router.get('/stats', getCreditStats);

/**
 * @route GET /api/credits/history
 * @desc Get user's credit consumption history with pagination
 * @access Private
 * @params {number} page - Page number (default: 1)
 * @params {number} limit - Records per page (default: 20, max: 100)
 */
router.get('/history', getCreditHistory);

/**
 * @route GET /api/credits/summary
 * @desc Get comprehensive credit consumption summary
 * @access Private
 * @params {number} period - Number of days for period summary (default: 30)
 */
router.get('/summary', getCreditSummary);

/**
 * @route GET /api/credits/:id
 * @desc Get detailed information about a specific credit consumption record
 * @access Private
 */
router.get('/:id', getCreditRecord);

/**
 * @route POST /api/credits/purchase
 * @desc Purchase additional credits for user's active plan
 * @access Private
 * @body {number} credits - Number of credits to purchase
 * @body {number} amount - Total amount for the purchase
 */
router.post('/purchase', purchaseCredits);

module.exports = router;