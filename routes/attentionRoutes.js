// routes/attentionRoutes.js
//
// /api/attention — the caller's Attention Center: everything waiting across
// all their projects. Business and partner accounts each get their own view
// (controllers/approvalController.getAttention). Mounted behind
// kindGate('business', 'partner').

const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { requireOrg } = require('../middleware/orgContext');
const { getAttention } = require('../controllers/approvalController');

const router = express.Router();

router.get('/', protect, requireOrg, getAttention);

module.exports = router;
