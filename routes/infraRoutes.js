// routes/infraRoutes.js
// Admin-only infrastructure monitoring API (§2, §19).
//
// Every route is behind protect + restrictTo('admin'), matching adminRoutes.js.
// Azure and Application Insights are called server-side only; no credential,
// token or connection string is ever returned.

const express = require('express');
const router = express.Router();

const { protect, restrictTo } = require('../middleware/authMiddleware');
const { asyncHandler } = require('../middleware/errorHandler');

const infra = require('../services/infra');
const appInsights = require('../services/infra/appInsights');
const azureArm = require('../services/infra/azureArm');
const { httpProbe, databaseProbe } = require('../services/infra/probes');
const { clear: clearCache } = require('../services/infra/cache');

// Admin-only, all of it.
router.use(protect, restrictTo('admin'));

const WINDOWS = ['1h', '6h', '24h', '7d', '30d'];
const pickWindow = (w) => (WINDOWS.includes(w) ? w : '24h');

/**
 * @route GET /api/admin/infrastructure/overview
 * @desc  Everything the dashboard needs, in one structured response (§19).
 * @query window  1h | 6h | 24h | 7d | 30d
 * @query force   'true' bypasses the cache (the Refresh button)
 */
router.get('/overview', asyncHandler(async (req, res) => {
  const data = await infra.getOverview({
    window: pickWindow(req.query.window),
    force: req.query.force === 'true',
  });
  res.json({ success: true, data });
}));

/**
 * @route GET /api/admin/infrastructure/backend-health
 * @desc  Backend reachability on its own (§9), for a targeted re-check.
 */
router.get('/backend-health', asyncHandler(async (req, res) => {
  const { backendUrl } = infra.targets();
  if (!backendUrl) {
    return res.json({
      success: true,
      data: {
        status: 'unknown',
        message: 'No BACKEND_URL configured — set it to the public API base URL',
      },
    });
  }
  const data = await httpProbe(`${backendUrl.replace(/\/$/, '')}/api/health`);
  res.json({ success: true, data });
}));

/**
 * @route GET /api/admin/infrastructure/database-health
 * @desc  MongoDB status (§12). Reuses the app's existing connection; the URI
 *        is never returned.
 */
router.get('/database-health', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await databaseProbe() });
}));

/**
 * @route GET /api/admin/infrastructure/errors
 * @desc  Recent errors, filterable (§11).
 * @query window  1h | 6h | 24h | 7d | 30d
 * @query kind    all | 4xx | 5xx
 */
router.get('/errors', asyncHandler(async (req, res) => {
  const kind = ['all', '4xx', '5xx'].includes(req.query.kind) ? req.query.kind : 'all';
  const data = await appInsights.getRecentErrors({
    window: pickWindow(req.query.window),
    kind,
  });
  res.json({ success: true, data });
}));

/**
 * @route GET /api/admin/infrastructure/cost
 * @desc  Azure cost with a selectable range (§6).
 * @query days  7 | 30 | month
 */
router.get('/cost', asyncHandler(async (req, res) => {
  const raw = req.query.days;
  const days = raw === 'month' ? 'month' : [7, 30].includes(Number(raw)) ? Number(raw) : 30;
  res.json({ success: true, data: await azureArm.getCost({ days }) });
}));

/**
 * @route GET /api/admin/infrastructure/config
 * @desc  Which integrations are wired up and which Azure roles they need (§27).
 *        Reports variable NAMES and required roles only — never a value.
 */
router.get('/config', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      azureArm: azureArm.configurationReport(),
      applicationInsights: appInsights.configurationReport(),
      targets: infra.targets(),
    },
  });
}));

/**
 * @route POST /api/admin/infrastructure/refresh
 * @desc  Drop every cached probe so the next read is live (§21).
 */
router.post('/refresh', asyncHandler(async (req, res) => {
  clearCache();
  res.json({ success: true, message: 'Cache cleared — the next read will be live.' });
}));

module.exports = router;
