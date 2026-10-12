const express = require('express');
const multer = require('multer');
const router = express.Router();
const { handleMailgunWebhook } = require('../controllers/webhookController');
const { handleInboundReply } = require('../controllers/inboundReplyController');

// No auth middleware — Mailgun sends these directly and authenticates by signature.
router.post('/mailgun', handleMailgunWebhook);

// ── Inbound replies ──────────────────────────────────────────────────────────
// Mailgun posts an inbound message as a form, not JSON, and in one of two
// encodings depending on the route action:
//   "forward"/"store" with attachments -> multipart/form-data
//   without attachments                -> application/x-www-form-urlencoded
// Both parsers are mounted so either works.
//
// The app-wide urlencoded limit is 10kb, which a real email body exceeds easily,
// so these routes get their own, larger limit.
const inboundMultipart = multer({
  limits: { fieldSize: 25 * 1024 * 1024, fileSize: 25 * 1024 * 1024 },
});

router.post(
  '/mailgun/inbound',
  inboundMultipart.any(),                                   // multipart/form-data
  express.urlencoded({ extended: true, limit: '25mb' }),    // x-www-form-urlencoded
  handleInboundReply
);

module.exports = router;
