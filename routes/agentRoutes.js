const express = require('express');
const multer = require('multer');
const { optionalAuth, protect } = require('../middleware/authMiddleware');
const {
  chatWithAgent,
  getAgentEvidence,
  getAgentThreadState,
  saveAgentWebsiteEvidence
} = require('../controllers/agentController');
const { draftEmail } = require('../controllers/hitlController');
const { uploadEmailRecipients } = require('../controllers/agentEmailController');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/chat', optionalAuth, chatWithAgent);
router.post('/draft-email', protect, draftEmail);
router.post('/email/recipients-csv', protect, upload.single('file'), uploadEmailRecipients);
router.get('/thread/:conversationId/state', optionalAuth, getAgentThreadState);
router.get('/thread/:conversationId/evidence', protect, getAgentEvidence);
router.post('/evidence/website', protect, saveAgentWebsiteEvidence);

module.exports = router;
