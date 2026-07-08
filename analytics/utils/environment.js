/**
 * Environment gating for analytics.
 *
 * Rule: only PRODUCTION traffic should ever reach the admin dashboard.
 *  - Every event is stamped with the env it came from (`currentEnv`).
 *  - In non-production, writes are skipped by default so dev/test traffic
 *    never pollutes analytics. Set ANALYTICS_ENABLED=true to force-record
 *    locally (those rows are stamped 'development' and are filtered out of the
 *    production dashboard anyway).
 *  - The dashboard reads only rows matching ANALYTICS_VIEW_ENV (default
 *    'production'), so development rows are invisible there.
 */

const currentEnv = () => process.env.NODE_ENV || 'development';

const isProduction = () => currentEnv() === 'production';

// Should we WRITE analytics for this process?
const analyticsEnabled = () => isProduction() || process.env.ANALYTICS_ENABLED === 'true';

// Which env's data does the dashboard show? Always production unless overridden
// locally for testing.
const viewEnv = () => process.env.ANALYTICS_VIEW_ENV || 'production';

module.exports = { currentEnv, isProduction, analyticsEnabled, viewEnv };
