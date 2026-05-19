const express = require('express');
const { query, param, body, validationResult } = require('express-validator');
const ProjectCatalog = require('../models/ProjectCatalog');
const ProjectPricing = require('../models/ProjectPricing');
const ProjectUser    = require('../models/ProjectUser');
const ExpertProfile = require('../models/ExpertProfile');
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');

const CATEGORY_MAP = {
  'Digital Marketing':      'outbound',
  'SEO':                    'traffic',
  'Content Marketing':      'brand',
  'Social Media Marketing': 'outreach',
  'Email Marketing':        'email',
  'PPC & Paid Ads':         'traffic',
  'Branding':               'brand',
  'Marketing Strategy':     'outbound',
  'Growth Hacking':         'outbound',
  'PR & Communications':    'brand',
  'Influencer Marketing':   'outreach',
  'Video Marketing':        'brand',
  'Analytics & Data':       'intelligence',
  'UX/UI Design':           'assistant',
  'Web Development':        'assistant',
  'Copywriting':            'email',
  'Graphic Design':         'brand',
  'E-commerce Marketing':   'traffic',
};

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
// POST /api/catalog  (PROTECTED)
// Any logged-in user can create a new catalog project + optional pricing tiers.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', [
  protect,
  body('slug').isString().trim().notEmpty().withMessage('slug is required'),
  body('title').isString().trim().notEmpty().withMessage('title is required'),
  body('description').isString().trim().notEmpty().withMessage('description is required'),
  body('category').notEmpty().withMessage('category is required'),
  handleValidationErrors,
], async (req, res) => {
  try {
    const { pricingTiers: tiersInput = [], ...catalogData } = req.body;

    const existing = await ProjectCatalog.findOne({ slug: catalogData.slug });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Slug "${catalogData.slug}" is already taken`,
      });
    }

    const project = await ProjectCatalog.create(catalogData);

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
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create project', error: err.message });
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
// GET /api/catalog/:slug/experts
// Returns all verified + public experts attached to a project
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:slug/experts', [
  param('slug').isString().trim(),
  handleValidationErrors,
], async (req, res) => {
  try {
    const project = await ProjectCatalog.findOne({
      slug: req.params.slug,
      isActive: true,
      isPublished: true,
    })
      .select('_id slug associatedExperts')
      .populate({
        path: 'associatedExperts.expertId',
        select: 'headline ratings profileStatus location pricing availability user _id',
        populate: { path: 'user', select: 'fullName avatar' },
      });

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    const experts = (project.associatedExperts || [])
      .filter(ae => ae.expertId && ae.expertId.profileStatus?.isPublic)
      .map(ae => ({
        expertProfileId: ae.expertId._id,
        name:            ae.expertId.user?.fullName || 'Expert',
        avatar:          ae.expertId.user?.avatar   || null,
        headline:        ae.expertId.headline        || '',
        rating:          ae.expertId.ratings?.overall      || 0,
        totalReviews:    ae.expertId.ratings?.totalReviews || 0,
        city:            ae.expertId.location?.city        || '',
        hourlyRateMin:   ae.expertId.pricing?.hourlyRate?.min || null,
        availability:    ae.expertId.availability?.status  || 'available',
        contribution:    ae.contribution || '',
        isVerified:      ae.isVerified,
      }));

    res.json({ success: true, data: { experts } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch experts', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/catalog/:slug/experts  (PROTECTED)
// Attaches the authenticated user's expert profile to a catalog project.
// Derives the best-matching project from the expert's primaryCategory if needed.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:slug/experts', [
  protect,
  param('slug').isString().trim(),
  body('contribution').optional().isString().trim().isLength({ max: 200 }),
  body('portfolioItemId').optional().isString(),
  handleValidationErrors,
], async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('profiles.expert hasExpertProfile');
    if (!user?.hasExpertProfile || !user.profiles?.expert) {
      return res.status(403).json({ success: false, message: 'Expert profile required' });
    }

    const expertProfile = await ExpertProfile.findById(user.profiles.expert).select('_id primaryCategory');
    if (!expertProfile) {
      return res.status(404).json({ success: false, message: 'Expert profile not found' });
    }

    const project = await ProjectCatalog.findOne({ slug: req.params.slug, isActive: true });
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    const alreadyLinked = project.associatedExperts?.some(
      ae => ae.expertId?.toString() === expertProfile._id.toString()
    );
    if (alreadyLinked) {
      return res.json({ success: true, message: 'Already linked to this project' });
    }

    project.associatedExperts.push({
      expertId:        expertProfile._id,
      portfolioItemId: req.body.portfolioItemId || null,
      contribution:    req.body.contribution || expertProfile.primaryCategory || '',
      isVerified:      false,
      addedAt:         new Date(),
    });

    await project.save();
    res.json({ success: true, message: 'Expert linked to project', data: { slug: project.slug } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to link expert', error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/catalog/:slug/experts/:expertProfileId  (PROTECTED)
// Removes an expert from a project's associatedExperts list.
// Only the expert themselves can unlink.
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:slug/experts/:expertProfileId', [
  protect,
  param('slug').isString().trim(),
  param('expertProfileId').isString().trim(),
  handleValidationErrors,
], async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('profiles.expert hasExpertProfile');
    if (!user?.hasExpertProfile || !user.profiles?.expert) {
      return res.status(403).json({ success: false, message: 'Expert profile required' });
    }

    if (user.profiles.expert.toString() !== req.params.expertProfileId) {
      return res.status(403).json({ success: false, message: 'You can only unlink your own profile' });
    }

    const project = await ProjectCatalog.findOne({ slug: req.params.slug });
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    const before = project.associatedExperts.length;
    project.associatedExperts = project.associatedExperts.filter(
      ae => ae.expertId?.toString() !== req.params.expertProfileId
    );

    if (project.associatedExperts.length === before) {
      return res.status(404).json({ success: false, message: 'Expert not linked to this project' });
    }

    await project.save();
    res.json({ success: true, message: 'Expert removed from project' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to remove expert', error: err.message });
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
