const express = require('express');
const router = express.Router();
const { handleMailgunWebhook } = require('../controllers/webhookController');

// No auth middleware — Mailgun sends these directly
router.post('/mailgun', handleMailgunWebhook);

module.exports = router;
