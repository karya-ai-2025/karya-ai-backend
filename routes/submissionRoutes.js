const express = require('express');
const { body, param, validationResult } = require('express-validator');
const ProjectSubmission = require('../models/ProjectSubmission');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation error', errors: errors.array() });
  }
  next();
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/submissions
// Create a new project brief submission (form or call booking)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', [
  protect,
  body('submissionType').isIn(['form', 'call']).withMessage('Invalid submission type'),
  body('title').trim().notEmpty().withMessage('Title is required'),
  handleValidationErrors,
], async (req, res) => {
  try {
    const {
      submissionType,
      title, tagline, category, description,
      goals, targetAudience, budget, timeline,
      expertSkillsNeeded, toolsUsed, deliverables,
      scheduledCall,
    } = req.body;

    const submission = await ProjectSubmission.create({
      userId: req.user._id,
      submissionType,
      title, tagline, category, description,
      goals, targetAudience, budget, timeline,
      expertSkillsNeeded: expertSkillsNeeded || [],
      toolsUsed:          toolsUsed          || [],
      deliverables:       deliverables       || [],
      scheduledCall:      scheduledCall      || undefined,
      status: 'submitted',
    });

    res.status(201).json({
      success: true,
      message: 'Submission received',
      data: { submission },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create submission', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/submissions/my
// All submissions by the authenticated user (newest first)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/my', protect, async (req, res) => {
  try {
    const submissions = await ProjectSubmission.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .select('-adminNotes -__v')
      .lean();

    res.json({ success: true, data: { submissions } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch submissions', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/submissions/:id
// Single submission detail — only accessible by the owner
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', [
  protect,
  param('id').isMongoId().withMessage('Invalid submission ID'),
  handleValidationErrors,
], async (req, res) => {
  try {
    const submission = await ProjectSubmission.findOne({
      _id: req.params.id,
      userId: req.user._id,
    }).lean();

    if (!submission) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }

    res.json({ success: true, data: { submission } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch submission', error: err.message });
  }
});

module.exports = router;
