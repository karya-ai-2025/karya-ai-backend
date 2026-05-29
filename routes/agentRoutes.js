const express = require('express');
const { optionalAuth, protect } = require('../middleware/authMiddleware');
const {
  chatWithAgent,
  getAgentEvidence,
  getAgentThreadState,
  saveAgentWebsiteEvidence
} = require('../controllers/agentController');

const router = express.Router();

router.post('/chat', optionalAuth, chatWithAgent);
router.get('/thread/:conversationId/state', optionalAuth, getAgentThreadState);
router.get('/thread/:conversationId/evidence', protect, getAgentEvidence);
router.post('/evidence/website', protect, saveAgentWebsiteEvidence);

module.exports = router;
