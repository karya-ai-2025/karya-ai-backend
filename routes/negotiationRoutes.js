const express = require('express');
const { body, param, validationResult } = require('express-validator');
const ProjectNegotiation = require('../models/ProjectNegotiation');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation error', errors: errors.array() });
  }
  next();
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/negotiations
// User submits a deliverable negotiation for a project (one per project, ever)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', [
  protect,
  body('projectSlug').isString().trim().notEmpty().withMessage('projectSlug is required'),
  body('tierId').isIn(['credit', 'bronze', 'silver', 'gold']).withMessage('Invalid tierId'),
  body('originalDeliverables').isArray({ min: 1 }).withMessage('originalDeliverables must be a non-empty array'),
  body('modifiedDeliverables').isArray({ min: 1 }).withMessage('modifiedDeliverables must be a non-empty array'),
  body('userNote').optional().isString().trim().isLength({ max: 500 }),
  handleValidation,
], async (req, res) => {
  try {
    const { projectSlug, tierId, originalDeliverables, modifiedDeliverables, userNote } = req.body;

    // Enforce one-negotiation-per-project rule
    const existing = await ProjectNegotiation.findOne({
      userId: req.user._id,
      projectSlug,
    }).lean();

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'You have already submitted a negotiation for this project',
        data: { negotiation: existing },
      });
    }

    const negotiation = await ProjectNegotiation.create({
      userId: req.user._id,
      projectSlug,
      tierId,
      originalDeliverables,
      modifiedDeliverables,
      userNote: userNote || '',
      status: 'pending',
    });

    res.status(201).json({
      success: true,
      message: 'Negotiation submitted successfully',
      data: { negotiation },
    });
  } catch (err) {
    // Catch duplicate key error from MongoDB unique index as a fallback
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'You have already submitted a negotiation for this project',
      });
    }
    res.status(500).json({ success: false, message: 'Failed to submit negotiation', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/negotiations/my/:projectSlug
// Returns the logged-in user's negotiation for a specific project (or null)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/my/:projectSlug', [
  protect,
  param('projectSlug').isString().trim(),
  handleValidation,
], async (req, res) => {
  try {
    const negotiation = await ProjectNegotiation.findOne({
      userId: req.user._id,
      projectSlug: req.params.projectSlug,
    }).lean();

    res.json({ success: true, data: { negotiation: negotiation || null } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch negotiation', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/negotiations
// All negotiations from all users — admin only
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', [protect, restrictTo('admin')], async (req, res) => {
  try {
    const negotiations = await ProjectNegotiation.find()
      .populate('userId', 'fullName email')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, data: { negotiations } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch negotiations', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/negotiations/:id/status
// Admin approves or rejects a negotiation
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/status', [
  protect, restrictTo('admin'),
  param('id').isString().trim(),
  body('status').isIn(['approved', 'rejected']).withMessage('status must be approved or rejected'),
  handleValidation,
], async (req, res) => {
  try {
    const negotiation = await ProjectNegotiation.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    )
      .populate('userId', 'fullName email')
      .lean();

    if (!negotiation) {
      return res.status(404).json({ success: false, message: 'Negotiation not found' });
    }

    res.json({
      success: true,
      message: `Negotiation ${req.body.status}`,
      data: { negotiation },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update negotiation', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/negotiations/:id
// Admin clears (permanently deletes) a negotiation so the user can re-submit
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', [
  protect, restrictTo('admin'),
  param('id').isString().trim(),
  handleValidation,
], async (req, res) => {
  try {
    const negotiation = await ProjectNegotiation.findByIdAndDelete(req.params.id).lean();

    if (!negotiation) {
      return res.status(404).json({ success: false, message: 'Negotiation not found' });
    }

    res.json({ success: true, message: 'Negotiation cleared successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to clear negotiation', error: err.message });
  }
});

module.exports = router;
