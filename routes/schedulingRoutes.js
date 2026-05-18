const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { protect } = require('../middleware/authMiddleware');
const ScheduledCall = require('../models/ScheduledCall');
const { createMeetEvent } = require('../utils/googleCalendar');
const { sendEmail, templates } = require('../utils/sendEmail');

const router = express.Router();

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(400).json({ success: false, message: 'Validation error', errors: errors.array() });
  next();
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/scheduling/book
// Books a 30-minute onboarding call, creates a Google Meet event, sends email
// ─────────────────────────────────────────────────────────────────────────────
router.post('/book', [
  protect,
  body('dateTime').isISO8601().toDate().withMessage('dateTime must be a valid ISO 8601 date string'),
  body('timezone').optional().isString().trim(),
  body('source').optional().isIn(['onboarding-owner', 'onboarding-expert']),
  handleValidation,
], async (req, res) => {
  try {
    const { dateTime, timezone = 'Asia/Kolkata', source = 'onboarding-owner' } = req.body;
    const { fullName, email } = req.user;

    const startTime = new Date(dateTime);
    const endTime   = new Date(startTime.getTime() + 30 * 60 * 1000); // 30-minute slot

    // Prevent double booking — one active call per user
    const existingCall = await ScheduledCall.findOne({ userId: req.user._id, status: 'scheduled' });
    if (existingCall) {
      return res.status(400).json({
        success: false,
        message: 'You already have a meeting scheduled. Complete your current call before booking a new one.',
        data: { existingCall },
      });
    }

    // Create Google Meet event (no-op mock when GCP credentials are not set)
    const { eventId, meetLink, isMock } = await createMeetEvent({
      summary:       `Karya-AI Onboarding Call — ${fullName}`,
      description:   `Onboarding call with ${fullName} (${email}). Source: ${source}`,
      startTime:     startTime.toISOString(),
      endTime:       endTime.toISOString(),
      attendeeEmail: email,
      timezone,
    });

    // Persist the booking
    const scheduledCall = await ScheduledCall.create({
      userId:        req.user._id,
      name:          fullName,
      email,
      dateTime:      startTime,
      timezone,
      meetLink,
      googleEventId: eventId,
      status:        'scheduled',
      source,
    });

    // Send confirmation email — non-critical, booking is already saved if this fails
    try {
      await sendEmail({
        to:      email,
        subject: 'Your Karya-AI Onboarding Call is Confirmed!',
        html:    templates.scheduleCallConfirmation(fullName, startTime, timezone, meetLink),
      });
    } catch (emailErr) {
      console.error('Confirmation email failed (booking still saved):', emailErr.message);
    }

    res.status(201).json({
      success: true,
      message: 'Call scheduled successfully',
      data: { scheduledCall, meetLink, isMock },
    });
  } catch (err) {
    console.error('Scheduling error:', err);
    res.status(500).json({ success: false, message: 'Failed to schedule call', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/scheduling/all  — admin: list all scheduled calls
// ─────────────────────────────────────────────────────────────────────────────
router.get('/all', protect, async (req, res) => {
  try {
    const calls = await ScheduledCall.find({})
      .populate('userId', 'fullName email role')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: calls });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/scheduling/my  — user: get their own latest scheduled call
// ─────────────────────────────────────────────────────────────────────────────
router.get('/my', protect, async (req, res) => {
  try {
    const call = await ScheduledCall.findOne({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: call });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/scheduling/:id/complete
// Admin — marks call as completed, triggers transcript pipeline after 20 min
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  '/:id/complete',
  [protect, param('id').isMongoId(), (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
    next();
  }],
  async (req, res) => {
    try {
      const call = await ScheduledCall.findById(req.params.id);
      if (!call) return res.status(404).json({ success: false, message: 'Call not found' });
      if (call.completedAt) return res.json({ success: true, message: 'Already marked complete' });

      call.completedAt = new Date();
      call.status      = 'completed';
      await call.save();

      res.json({ success: true, data: call });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

module.exports = router;
