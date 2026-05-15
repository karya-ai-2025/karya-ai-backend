const express = require('express');
const { param, validationResult } = require('express-validator');
const { protect, restrictTo }     = require('../middleware/authMiddleware');
const ScheduledCall               = require('../models/ScheduledCall');
const CallTranscript              = require('../models/CallTranscript');
const { runTranscriptPipeline }   = require('../utils/transcriptPipeline');

const router = express.Router();

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(400).json({ success: false, errors: errors.array() });
  next();
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/transcripts/process/:callId
// Admin — manually trigger the transcript pipeline for a specific call
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/process/:callId',
  [protect, restrictTo('admin'), param('callId').isMongoId(), handleValidation],
  async (req, res) => {
    try {
      const result = await runTranscriptPipeline(req.params.callId);
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/transcripts
// Admin — list all transcripts with optional status filter
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', [protect, restrictTo('admin')], async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter = status ? { status } : {};

  const [transcripts, total] = await Promise.all([
    CallTranscript.find(filter)
      .populate('scheduledCallId', 'name email dateTime meetLink source')
      .populate('userId', 'fullName email role')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean(),
    CallTranscript.countDocuments(filter),
  ]);

  res.json({ success: true, total, page: Number(page), data: transcripts });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/transcripts/:callId
// Admin — get transcript for a specific scheduled call
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/:callId',
  [protect, restrictTo('admin'), param('callId').isMongoId(), handleValidation],
  async (req, res) => {
    const transcript = await CallTranscript.findOne({ scheduledCallId: req.params.callId })
      .populate('scheduledCallId', 'name email dateTime meetLink source')
      .populate('userId', 'fullName email role')
      .lean();

    if (!transcript)
      return res.status(404).json({ success: false, message: 'Transcript not found' });

    res.json({ success: true, data: transcript });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/transcripts/:id/apply
// Admin — apply extracted profile data to the user's profile (non-destructive)
// Only fills fields that are currently empty on the profile
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  '/:id/apply',
  [protect, restrictTo('admin'), param('id').isMongoId(), handleValidation],
  async (req, res) => {
    const transcript = await CallTranscript.findById(req.params.id).populate('userId');
    if (!transcript)
      return res.status(404).json({ success: false, message: 'Transcript not found' });

    if (transcript.appliedToProfile)
      return res.json({ success: true, message: 'Already applied to profile' });

    if (!transcript.extractedData)
      return res.status(400).json({ success: false, message: 'No extracted data to apply' });

    const { extractedData } = transcript;
    const user = transcript.userId;

    if (user) {
      const User = require('../models/User');
      const updates = {};

      // Non-destructive: only set fields not already present on the user document
      if (extractedData.name        && !user.fullName)     updates.fullName     = extractedData.name;
      if (extractedData.companyName && !user.companyName)  updates.companyName  = extractedData.companyName;
      if (extractedData.industry    && !user.industry)     updates.industry     = extractedData.industry;

      if (Object.keys(updates).length) {
        await User.findByIdAndUpdate(user._id, { $set: updates });
      }
    }

    await CallTranscript.findByIdAndUpdate(transcript._id, {
      appliedToProfile: true,
      status: 'applied',
    });

    res.json({ success: true, message: 'Extracted data applied to profile' });
  }
);

module.exports = router;
