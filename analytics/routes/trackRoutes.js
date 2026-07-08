// Public-facing ingestion routes — the frontend posts page views + events here.
// optionalAuth means logged-in users are attributed; guests still count.

const express = require('express');
const { optionalAuth } = require('../../middleware/authMiddleware');
const { trackPage, trackEvent } = require('../controllers/analyticsController');

const router = express.Router();

router.post('/page', optionalAuth, trackPage);
router.post('/event', optionalAuth, trackEvent);

module.exports = router;
