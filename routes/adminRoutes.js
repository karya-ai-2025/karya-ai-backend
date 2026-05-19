// routes/adminRoutes.js
// Admin-only routes — all protected by protect + restrictTo('admin')

const express        = require('express');
const router         = express.Router();
const User           = require('../models/User');
const ProjectCatalog = require('../models/ProjectCatalog');
const ProjectPricing = require('../models/ProjectPricing');
const { protect, restrictTo } = require('../middleware/authMiddleware');
const { asyncHandler }        = require('../middleware/errorHandler');

// Apply protect + admin restriction to every route in this file
router.use(protect, restrictTo('admin'));

// GET /api/admin/analytics/users
// Returns user counts (total, today, week, month) + full user list
router.get('/analytics/users', asyncHandler(async (req, res) => {
  const now           = new Date();
  const startOfDay    = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek   = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startOfMonth  = new Date(now.getFullYear(), now.getMonth(), 1);

  const [total, newToday, newThisWeek, newThisMonth, byRole, users] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ createdAt: { $gte: startOfDay } }),
    User.countDocuments({ createdAt: { $gte: startOfWeek } }),
    User.countDocuments({ createdAt: { $gte: startOfMonth } }),
    User.aggregate([
      { $group: { _id: '$activeRole', count: { $sum: 1 } } },
    ]),
    User.find({}, 'fullName email activeRole createdAt isEmailVerified isActive')
        .sort({ createdAt: -1 })
        .limit(500)
        .lean(),
  ]);

  // Convert aggregate array into a plain object { owner: N, expert: N, admin: N }
  const roleBreakdown = { owner: 0, expert: 0, admin: 0 };
  byRole.forEach(({ _id, count }) => {
    if (_id && roleBreakdown.hasOwnProperty(_id)) roleBreakdown[_id] = count;
  });

  res.status(200).json({
    success: true,
    data: {
      counts: {
        total,
        newToday,
        newThisWeek,
        newThisMonth,
      },
      roleBreakdown,
      users,
    },
  });
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/catalog
// Create a new catalog project + optional pricing tiers in one call.
// Body: { ...ProjectCatalog fields, pricingTiers: [ ...ProjectPricing fields ] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/catalog', asyncHandler(async (req, res) => {
  const { pricingTiers: tiersInput = [], ...catalogData } = req.body;

  // Required field check
  const missing = ['slug', 'title', 'description', 'category'].filter(f => !catalogData[f]);
  if (missing.length) {
    return res.status(400).json({
      success: false,
      message: `Missing required fields: ${missing.join(', ')}`,
    });
  }

  // Slug uniqueness
  const existing = await ProjectCatalog.findOne({ slug: catalogData.slug });
  if (existing) {
    return res.status(409).json({
      success: false,
      message: `Slug "${catalogData.slug}" is already taken`,
    });
  }

  // Create catalog entry
  const project = await ProjectCatalog.create(catalogData);

  // Create pricing tiers linked to this project
  let tiers = [];
  if (tiersInput.length > 0) {
    const tierDocs = tiersInput.map((t, i) => ({
      ...t,
      projectId:    project._id,
      displayOrder: t.displayOrder ?? i + 1,
    }));
    tiers = await ProjectPricing.insertMany(tierDocs);
  }

  res.status(201).json({
    success: true,
    message: 'Project created successfully',
    data: { project, tiers },
  });
}));

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/catalog/:slug
// Update an existing catalog project's fields (partial update).
// ─────────────────────────────────────────────────────────────────────────────
router.put('/catalog/:slug', asyncHandler(async (req, res) => {
  const { pricingTiers: _ignored, ...updateData } = req.body;

  // Prevent changing slug to a taken value
  if (updateData.slug && updateData.slug !== req.params.slug) {
    const conflict = await ProjectCatalog.findOne({ slug: updateData.slug });
    if (conflict) {
      return res.status(409).json({ success: false, message: `Slug "${updateData.slug}" is already taken` });
    }
  }

  const project = await ProjectCatalog.findOneAndUpdate(
    { slug: req.params.slug },
    { $set: updateData },
    { new: true, runValidators: true }
  );

  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }

  res.json({ success: true, message: 'Project updated', data: { project } });
}));

module.exports = router;
