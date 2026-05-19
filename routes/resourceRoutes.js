const express = require('express');
const router = express.Router();
const Resource = require('../models/Resource');
const { protect } = require('../middleware/authMiddleware');
const { restrictTo } = require('../middleware/authMiddleware');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

// ── GET /api/resources — public, returns all published resources ─────────────
router.get('/', asyncHandler(async (req, res) => {
  const { type, search } = req.query;
  const query = { isPublished: true };

  if (type && type !== 'all') query.type = type;
  if (search) {
    const re = new RegExp(search, 'i');
    query.$or = [{ title: re }, { description: re }, { topics: re }];
  }

  const resources = await Resource.find(query)
    .sort({ order: 1, createdAt: -1 })
    .lean();

  res.json({ status: 'success', data: { resources } });
}));

// ── POST /api/resources — admin only, create a resource ──────────────────────
router.post('/', [protect, restrictTo('admin')], asyncHandler(async (req, res) => {
  const resource = await Resource.create(req.body);
  res.status(201).json({ status: 'success', data: { resource } });
}));

// ── PUT /api/resources/:id — admin only, update a resource ───────────────────
router.put('/:id', [protect, restrictTo('admin')], asyncHandler(async (req, res) => {
  const resource = await Resource.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!resource) return next(new AppError('Resource not found', 404));
  res.json({ status: 'success', data: { resource } });
}));

// ── DELETE /api/resources/:id — admin only ───────────────────────────────────
router.delete('/:id', [protect, restrictTo('admin')], asyncHandler(async (req, res) => {
  const resource = await Resource.findByIdAndDelete(req.params.id);
  if (!resource) return next(new AppError('Resource not found', 404));
  res.json({ status: 'success', data: null });
}));

module.exports = router;
