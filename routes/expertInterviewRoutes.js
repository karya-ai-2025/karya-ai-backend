// routes/expertInterviewRoutes.js
// ElevenLabs voice interview an expert takes after onboarding

const express = require('express');
const router = express.Router();

const { getStatus, createSession, markStarted, markEnded } = require('../controllers/expertInterviewController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/status', getStatus);
router.post('/session', createSession);
router.post('/:id/started', markStarted);
router.post('/:id/ended', markEnded);

module.exports = router;
