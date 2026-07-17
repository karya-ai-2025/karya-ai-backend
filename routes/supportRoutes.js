const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { getSupportStatus, sendSupportEmail, subscribeToUpdates } = require('../controllers/supportController');

const router = express.Router();

router.get('/status', protect, getSupportStatus);
router.post('/contact', protect, sendSupportEmail);
router.post('/subscribe', protect, subscribeToUpdates);

module.exports = router;
