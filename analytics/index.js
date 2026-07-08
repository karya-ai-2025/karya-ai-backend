/**
 * Analytics module — self-contained product analytics for Karya-AI.
 *
 * Separate from Azure Application Insights (which handles infra/health).
 * This tracks user behaviour (page views, events, API usage, sessions) into a
 * single MongoDB collection and exposes admin dashboard APIs.
 *
 * Wiring (in index.js):
 *   const analytics = require('./analytics');
 *   app.use(analytics.apiTracker);                       // after body parsers
 *   app.use('/api/analytics', analytics.trackRoutes);    // frontend ingestion
 *   app.use('/api/admin/analytics', analytics.adminRoutes); // dashboard (after adminRoutes)
 */

module.exports = {
  apiTracker:  require('./middleware/apiTracker').apiTracker,
  trackRoutes: require('./routes/trackRoutes'),
  adminRoutes: require('./routes/adminAnalyticsRoutes'),
  service:     require('./services/analyticsService')
};
