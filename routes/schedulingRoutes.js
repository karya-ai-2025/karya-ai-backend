const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const { param, validationResult } = require('express-validator');
const { protect } = require('../middleware/authMiddleware');
const ScheduledCall = require('../models/ScheduledCall');
const User = require('../models/User');
const { config } = require('../config/config');

const router = express.Router();

const adminOnly = (req, res, next) =>
  req.user.isAdmin ? next() : res.status(403).json({ success: false, message: 'Admin access required' });

// Calls are booked on Cal.com (embedded by the frontend), which picks the slot,
// creates the video link and emails both sides. Nothing here depends on the
// member being signed in to any calendar. Cal.com then tells us about the
// booking through the webhook below.

const isValidSignature = (rawBody, signature) => {
  const secret = config.calcom.webhookSecret;
  if (!secret || !rawBody || typeof signature !== 'string') return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// The booking link carries metadata[userId] for signed-in members; fall back to
// the attendee's email for bookings made any other way.
const findBookingUser = async (payload) => {
  const userId = payload.metadata?.userId;
  if (typeof userId === 'string' && mongoose.isValidObjectId(userId)) {
    const user = await User.findById(userId);
    if (user) return user;
  }
  const email = payload.attendees?.[0]?.email;
  return typeof email === 'string' ? User.findOne({ email: email.toLowerCase().trim() }) : null;
};

const videoLink = (payload) => {
  const candidates = [payload.metadata?.videoCallUrl, payload.videoCallData?.url, payload.location];
  return candidates.find((v) => typeof v === 'string' && /^https?:\/\//.test(v)) || null;
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/scheduling/calcom/webhook
// Cal.com → us. Subscribe to BOOKING_CREATED, BOOKING_RESCHEDULED and
// BOOKING_CANCELLED, with the secret set to CALCOM_WEBHOOK_SECRET.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/calcom/webhook', async (req, res) => {
  if (!config.calcom.webhookSecret) {
    return res.status(503).json({ success: false, message: 'Cal.com webhook is not configured' });
  }
  if (!isValidSignature(req.rawBody, req.get('x-cal-signature-256'))) {
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }

  try {
    const { triggerEvent, payload = {} } = req.body || {};
    const uid = typeof payload.uid === 'string' ? payload.uid : null;
    if (!uid) return res.json({ success: true, ignored: true });

    if (triggerEvent === 'BOOKING_CANCELLED') {
      await ScheduledCall.updateOne({ calBookingUid: uid }, { status: 'cancelled' });
      return res.json({ success: true });
    }

    if (triggerEvent !== 'BOOKING_CREATED' && triggerEvent !== 'BOOKING_RESCHEDULED') {
      return res.json({ success: true, ignored: true });
    }

    const user = await findBookingUser(payload);
    const startTime = new Date(payload.startTime);
    // Not one of our members (or a malformed event) — acknowledge so Cal.com doesn't retry
    if (!user || Number.isNaN(startTime.getTime())) return res.json({ success: true, ignored: true });

    const fields = {
      userId: user._id,
      name: user.fullName,
      email: user.email,
      dateTime: startTime,
      timezone: payload.attendees?.[0]?.timeZone || 'UTC',
      meetLink: videoLink(payload),
      calBookingUid: uid,
      status: 'scheduled',
      source: user.activeRole === 'expert' ? 'onboarding-expert' : 'onboarding-owner',
      reminderSent: false
    };

    // A reschedule arrives with a new uid and the old one in rescheduleUid
    const previousUid = typeof payload.rescheduleUid === 'string' ? payload.rescheduleUid : null;
    const existing = await ScheduledCall.findOne({ calBookingUid: { $in: [uid, previousUid].filter(Boolean) } });
    if (existing) {
      existing.set(fields);
      await existing.save();
    } else {
      await ScheduledCall.create(fields);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Cal.com webhook error:', err);
    res.status(500).json({ success: false, message: 'Failed to record booking' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/scheduling/all  — admin: list all scheduled calls
// ─────────────────────────────────────────────────────────────────────────────
router.get('/all', protect, adminOnly, async (req, res) => {
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
  [protect, adminOnly, param('id').isMongoId(), (req, res, next) => {
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
