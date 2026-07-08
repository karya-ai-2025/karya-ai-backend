/**
 * apiTracker — app-level middleware that records every /api/* call AFTER the
 * response is sent (res 'finish'), so it never adds latency to the request.
 * It reads req.user (already set by auth middleware by the time finish fires).
 */

const { recordApiUsage } = require('../services/analyticsService');
const { buildContext } = require('../utils/requestContext');

// Don't track analytics' own endpoints, health/root, or preflight.
const SKIP = [/^\/api\/analytics/, /^\/api\/admin\/analytics/, /^\/api\/health/];

const apiTracker = (req, res, next) => {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    try {
      if (req.method === 'OPTIONS') return;
      const path = (req.originalUrl || req.url || '').split('?')[0];
      if (!path.startsWith('/api/')) return;
      if (SKIP.some((re) => re.test(path))) return;

      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      // Prefer the route pattern (/api/leads/:id) over the raw URL for grouping.
      const api = req.route ? `${req.baseUrl}${req.route.path}` : path;

      recordApiUsage({
        context: buildContext(req),
        api,
        method: req.method,
        statusCode: res.statusCode,
        duration: Math.round(durationMs)
      });
    } catch {
      /* analytics must never break a response */
    }
  });

  next();
};

module.exports = { apiTracker };
