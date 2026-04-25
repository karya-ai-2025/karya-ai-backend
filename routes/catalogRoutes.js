const express = require('express');
const { query, param, body, validationResult } = require('express-validator');
const ProjectCatalog = require('../models/ProjectCatalog');
const ProjectPricing = require('../models/ProjectPricing');
const ProjectUser = require('../models/ProjectUser');
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
// GET /api/catalog
// List all projects — supports ?category=&featured=&trending=&search=
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', [
  query('category').optional().isString(),
  query('featured').optional().isBoolean(),
  query('trending').optional().isBoolean(),
  query('search').optional().isString().trim(),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('page').optional().isInt({ min: 1 }),
  handleValidationErrors,
], async (req, res) => {
  try {
    const { category, featured, trending, search, limit = 20, page = 1 } = req.query;

    const filter = { isActive: true, isPublished: true };
    if (category)         filter.category  = category;
    if (featured === 'true') filter.isFeatured = true;
    if (trending === 'true') filter.isTrending = true;
    if (search) {
      filter.$or = [
        { title:       { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tagline:     { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [projects, total] = await Promise.all([
      ProjectCatalog.find(filter)
        .select('-__v -faq -howItWorks -subjects -matchIndustries')
        .sort({ isFeatured: -1, isTrending: -1, createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      ProjectCatalog.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: {
        projects,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch projects', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/catalog/featured
// ─────────────────────────────────────────────────────────────────────────────
router.get('/featured', async (req, res) => {
  try {
    const projects = await ProjectCatalog.find({ isActive: true, isPublished: true, isFeatured: true })
      .select('-__v -faq -howItWorks -subjects -tools -expertSkills -matchIndustries')
      .sort({ 'stats.trendingCount': -1 })
      .limit(6)
      .lean();

    res.json({ success: true, data: { projects } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch featured projects', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/catalog/trending
// ─────────────────────────────────────────────────────────────────────────────
router.get('/trending', async (req, res) => {
  try {
    const projects = await ProjectCatalog.find({ isActive: true, isPublished: true, isTrending: true })
      .select('-__v -faq -howItWorks -subjects -tools -expertSkills -matchIndustries')
      .sort({ 'stats.trendingCount': -1 })
      .limit(6)
      .lean();

    res.json({ success: true, data: { projects } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch trending projects', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/catalog/categories
// Returns distinct category list + count per category
// ─────────────────────────────────────────────────────────────────────────────
router.get('/categories', async (req, res) => {
  try {
    const counts = await ProjectCatalog.aggregate([
      { $match: { isActive: true, isPublished: true } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    res.json({ success: true, data: { categories: counts.map(c => ({ category: c._id, count: c.count })) } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch categories', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/catalog/user/my-projects  (PROTECTED)
// Returns all catalog projects the authenticated user has purchased.
// Must be defined BEFORE /:slug so Express does not treat "user" as a slug.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/user/my-projects', protect, async (req, res) => {
  try {
    const purchases = await ProjectUser.find({
      userId: req.user._id,
      catalogId: { $ne: null },
    })
      .populate('catalogId', 'slug title tagline theme stats isFeatured')
      .sort({ lastAccessedAt: -1 })
      .lean();

    const projects = purchases.map(p => ({
      slug:            p.projectSlug,
      title:           p.catalogId?.title   || p.projectSlug,
      tagline:         p.catalogId?.tagline || '',
      tierId:          p.tierId,
      status:          p.status,
      progress:        p.progress,
      purchasedAt:     p.startedAt,
      lastAccessedAt:  p.lastAccessedAt,
    }));

    res.json({ success: true, data: { projects } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch my projects', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/catalog/:slug/purchase  (PROTECTED)
// Records a marketplace project purchase for the authenticated user.
// Upserts so re-purchasing the same project just updates the tier.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:slug/purchase', [
  protect,
  param('slug').isString().trim(),
  body('tierId').isIn(['credit', 'bronze', 'silver', 'gold']).withMessage('Invalid tierId'),
  handleValidationErrors,
], async (req, res) => {
  try {
    const { tierId } = req.body;

    const catalog = await ProjectCatalog.findOne({
      slug: req.params.slug,
      isActive: true,
    }).select('_id title slug').lean();

    if (!catalog) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // Upsert: create if new, update tierId + lastAccessedAt if already exists
    const purchase = await ProjectUser.findOneAndUpdate(
      { userId: req.user._id, catalogId: catalog._id },
      {
        $setOnInsert: {
          userId:      req.user._id,
          catalogId:   catalog._id,
          projectSlug: catalog.slug,
          status:      'started',
          startedAt:   new Date(),
        },
        $set: {
          tierId,
          lastAccessedAt: new Date(),
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    res.json({
      success: true,
      message: 'Purchase recorded',
      data: {
        slug:        catalog.slug,
        title:       catalog.title,
        tierId:      purchase.tierId,
        status:      purchase.status,
        purchasedAt: purchase.startedAt,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to record purchase', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/catalog/:slug/purchase  (PROTECTED)
// Removes the user's purchase record for this project (unlinks it from My Projects).
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:slug/purchase', [
  protect,
  param('slug').isString().trim(),
  handleValidationErrors,
], async (req, res) => {
  try {
    const catalog = await ProjectCatalog.findOne({ slug: req.params.slug }).select('_id').lean();
    if (!catalog) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    const result = await ProjectUser.findOneAndDelete({
      userId:    req.user._id,
      catalogId: catalog._id,
    });

    if (!result) {
      return res.status(404).json({ success: false, message: 'Purchase record not found' });
    }

    res.json({ success: true, message: 'Project removed from your account' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to remove project', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/catalog/:slug
// Full project detail — includes pricing tiers via virtual populate
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:slug', [
  param('slug').isString().trim(),
  handleValidationErrors,
], async (req, res) => {
  try {
    const project = await ProjectCatalog.findOne({
      slug: req.params.slug,
      isActive: true,
      isPublished: true,
    })
      .populate({
        path: 'pricingTiers',
        match: { isActive: true },
        options: { sort: { displayOrder: 1 } },
        select: '-__v -projectId',
      })
      .select('-__v')
      .lean({ virtuals: true });

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    res.json({ success: true, data: { project } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch project', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/catalog/:slug/pricing
// Just the pricing tiers for a project (lightweight)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:slug/pricing', [
  param('slug').isString().trim(),
  handleValidationErrors,
], async (req, res) => {
  try {
    const project = await ProjectCatalog.findOne({ slug: req.params.slug, isActive: true }).select('_id title').lean();

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    const tiers = await ProjectPricing.find({ projectId: project._id, isActive: true })
      .sort({ displayOrder: 1 })
      .select('-__v -projectId')
      .lean();

    const shaped = tiers.map(t => ({
      tierId:             t.tierId,
      name:               t.name,
      badge:              t.badge || null,
      popular:            t.popular,
      displayOrder:       t.displayOrder,
      amount:             t.price.amount,
      priceLabel:         t.price.label,
      billingCycle:       t.price.billingCycle,
      billingNote:        t.price.note || null,
      contacts:           t.quantities?.contacts || null,
      deliverableSummary: t.deliverableSummary || null,
      features:           t.features,
      support:            t.support,
    }));

    res.json({ success: true, data: { projectId: project._id, title: project.title, tiers: shaped } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch pricing', error: err.message });
  }
});

module.exports = router;
