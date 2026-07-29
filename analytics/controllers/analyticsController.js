const svc = require('../services/analyticsService');
const { buildContext } = require('../utils/requestContext');
const { asyncHandler } = require('../../middleware/errorHandler');

const parseRange = (req) => ({
  from: req.query.from ? new Date(req.query.from) : undefined,
  to:   req.query.to   ? new Date(req.query.to)   : undefined
});

// ── Ingestion (called by the frontend; optionalAuth so guests count too) ─────
const trackPage = asyncHandler(async (req, res) => {
  svc.recordPageView({
    context: buildContext(req),
    page: req.body.page || '',
    pageTitle: req.body.pageTitle || ''
  });
  res.status(202).json({ success: true });
});

const trackEvent = asyncHandler(async (req, res) => {
  const eventType = req.body.eventName || req.body.eventType;
  if (!eventType) return res.status(400).json({ success: false, message: 'eventName is required' });
  svc.recordEvent({
    context: buildContext(req),
    eventType,
    metadata: req.body.metadata || {},
    status: req.body.status === 'failure' ? 'failure' : 'success'
  });
  res.status(202).json({ success: true });
});

// ── Dashboard (admin only) ───────────────────────────────────────────────────
const overview   = asyncHandler(async (req, res) => res.json({ success: true, data: await svc.overview() }));
const pages      = asyncHandler(async (req, res) => { const { from, to } = parseRange(req); res.json({ success: true, data: await svc.pages(from, to) }); });
const pagesByUser = asyncHandler(async (req, res) => { const { from, to } = parseRange(req); res.json({ success: true, data: await svc.pagesByUser(from, to) }); });
const events     = asyncHandler(async (req, res) => { const { from, to } = parseRange(req); res.json({ success: true, data: await svc.events(from, to) }); });
const apis       = asyncHandler(async (req, res) => { const { from, to } = parseRange(req); res.json({ success: true, data: await svc.apis(from, to) }); });
const usersStats = asyncHandler(async (req, res) => { const { from, to } = parseRange(req); res.json({ success: true, data: await svc.users(from, to) }); });
const funnels    = asyncHandler(async (req, res) => res.json({ success: true, data: await svc.funnels() }));
const onboardingFunnels = asyncHandler(async (req, res) => { const { from, to } = parseRange(req); res.json({ success: true, data: await svc.onboardingFunnels(from, to) }); });
const features   = asyncHandler(async (req, res) => { const { from, to } = parseRange(req); res.json({ success: true, data: await svc.features(from, to) }); });
const geography  = asyncHandler(async (req, res) => { const { from, to } = parseRange(req); res.json({ success: true, data: await svc.geography(from, to) }); });
const realtime   = asyncHandler(async (req, res) => res.json({ success: true, data: await svc.realtime() }));

module.exports = {
  trackPage, trackEvent,
  overview, pages, pagesByUser, events, apis, usersStats, funnels, onboardingFunnels, features, geography, realtime
};
