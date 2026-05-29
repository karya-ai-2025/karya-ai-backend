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
// GET /api/admin/analytics/azure — Azure Application Insights metrics
// Requires env vars: AZURE_APP_INSIGHTS_APP_ID, AZURE_APP_INSIGHTS_API_KEY
// Get these from: Azure Portal → Application Insights → Configure → API Access
// ─────────────────────────────────────────────────────────────────────────────
router.get('/analytics/azure', asyncHandler(async (req, res) => {
  const appId  = process.env.AZURE_APP_INSIGHTS_APP_ID;
  const apiKey = process.env.AZURE_APP_INSIGHTS_API_KEY;

  if (!appId || !apiKey) {
    return res.json({ success: true, data: { configured: false } });
  }

  const AI_BASE = `https://api.applicationinsights.io/v1/apps/${appId}`;
  const headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json' };

  // Execute a Kusto query against Application Insights
  async function kusto(query) {
    const r = await fetch(`${AI_BASE}/query`, {
      method:  'POST',
      headers,
      body: JSON.stringify({ query, timespan: 'P7D' }),
    });
    if (!r.ok) {
      const err = await r.text();
      throw new Error(`App Insights API ${r.status}: ${err}`);
    }
    return r.json();
  }

  // Convert a raw App Insights table into an array of plain objects
  function tableToRows(result) {
    const table = result?.tables?.[0];
    if (!table) return [];
    return table.rows.map(row =>
      Object.fromEntries(table.columns.map((col, i) => [col.name, row[i]]))
    );
  }

  const [reqResult, errResult, rtResult, pvResult, exResult, liveResult] =
    await Promise.allSettled([
      // Daily request count
      kusto(`requests
        | summarize count() by bin(timestamp, 1d)
        | order by timestamp asc`),
      // Daily error rate
      kusto(`requests
        | summarize total=count(), failed=countif(success==false) by bin(timestamp, 1d)
        | extend errorRate=round(todouble(failed)/todouble(total)*100, 1)
        | order by timestamp asc`),
      // Daily avg response time (ms)
      kusto(`requests
        | summarize avgMs=round(avg(duration), 1) by bin(timestamp, 1d)
        | order by timestamp asc`),
      // Daily page views
      kusto(`pageViews
        | summarize count() by bin(timestamp, 1d)
        | order by timestamp asc`),
      // Daily exceptions
      kusto(`exceptions
        | summarize count() by bin(timestamp, 1d)
        | order by timestamp asc`),
      // 7-day totals in one query
      kusto(`union requests, pageViews, exceptions
        | summarize
            totalRequests = countif(itemType == "request"),
            totalPageViews = countif(itemType == "pageView"),
            totalExceptions = countif(itemType == "exception"),
            failedRequests  = countif(itemType == "request" and success == false),
            avgResponseMs   = round(avg(iif(itemType == "request", duration, real(null))), 1)`),
    ]);

  const totalsRow = tableToRows(liveResult.status === 'fulfilled' ? liveResult.value : {});

  res.json({
    success: true,
    data: {
      configured:   true,
      totals:       totalsRow[0] || {},
      requests:     tableToRows(reqResult.status    === 'fulfilled' ? reqResult.value    : {}),
      errors:       tableToRows(errResult.status    === 'fulfilled' ? errResult.value    : {}),
      responseTime: tableToRows(rtResult.status     === 'fulfilled' ? rtResult.value     : {}),
      pageViews:    tableToRows(pvResult.status     === 'fulfilled' ? pvResult.value     : {}),
      exceptions:   tableToRows(exResult.status     === 'fulfilled' ? exResult.value     : {}),
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
