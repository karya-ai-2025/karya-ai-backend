// services/infra/appInsights.js
// Application Insights queries for the infrastructure dashboard (§10, §11).
//
// Uses the same API and key already wired up in routes/adminRoutes.js
// (api.applicationinsights.io + x-api-key), so there is only one App Insights
// integration in the codebase. Queries are Kusto; every one is wrapped so a
// single failing query cannot take the section down.
//
// Request bodies, headers and any customDimensions are never selected — only
// counts, durations, names and result codes (§10: no sensitive request bodies).

const { STATUS } = require('./probes');

const appId = () => (process.env.AZURE_APP_INSIGHTS_APP_ID || '').trim();
const apiKey = () => (process.env.AZURE_APP_INSIGHTS_API_KEY || '').trim();

const isConfigured = () => !!(appId() && apiKey());

function configurationReport() {
  const missing = [];
  if (!appId()) missing.push('AZURE_APP_INSIGHTS_APP_ID');
  if (!apiKey()) missing.push('AZURE_APP_INSIGHTS_API_KEY');
  return {
    configured: isConfigured(),
    missing,
    requiredRoles: [
      {
        scope: 'Application Insights resource',
        role: 'API key with "Read telemetry"',
        why: 'Request counts, failures, response times and exceptions',
      },
    ],
  };
}

/** Timespan strings accepted by the App Insights API. */
const TIMESPAN = {
  '1h': 'PT1H',
  '6h': 'PT6H',
  '24h': 'P1D',
  '7d': 'P7D',
  '30d': 'P30D',
};

async function kusto(query, timespan = 'P1D', timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.applicationinsights.io/v1/apps/${appId()}/query`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, timespan }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // The body can echo the query; keep only the status.
      throw new Error(`Application Insights returned HTTP ${res.status}`);
    }
    return rows(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

/** Turn an App Insights table into plain objects. */
function rows(result) {
  const table = result?.tables?.[0];
  if (!table) return [];
  return table.rows.map((row) =>
    Object.fromEntries(table.columns.map((c, i) => [c.name, row[i]]))
  );
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round = (n, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * §10 — requests, errors, performance and auth, in one pass.
 * Each query settles independently; a failure leaves that block null rather
 * than failing the whole section.
 */
async function getTelemetry({ window = '24h', slowMs = 1000 } = {}) {
  if (!isConfigured()) {
    return {
      status: STATUS.UNKNOWN,
      configured: false,
      message: 'Unknown — Application Insights credentials are not configured',
      setup: configurationReport(),
      checkedAt: new Date().toISOString(),
    };
  }

  const span = TIMESPAN[window] || TIMESPAN['24h'];

  const [summary, byCode, slowest, topFailing, exceptions, auth] = await Promise.allSettled([
    kusto(`requests
      | summarize total=count(),
                  failed=countif(success==false),
                  avgMs=round(avg(duration),1),
                  p95Ms=round(percentile(duration,95),1)`, span),

    kusto(`requests
      | extend bucket = case(toint(resultCode) >= 500, "5xx",
                             toint(resultCode) >= 400, "4xx",
                             "other")
      | summarize count() by bucket`, span),

    kusto(`requests
      | summarize avgMs=round(avg(duration),1), calls=count() by name
      | where calls > 0
      | top 8 by avgMs desc`, span),

    kusto(`requests
      | where success == false
      | summarize failures=count(), lastSeen=max(timestamp) by name, resultCode
      | top 8 by failures desc`, span),

    kusto(`exceptions
      | summarize occurrences=count(), lastSeen=max(timestamp) by type, outerMessage
      | top 8 by occurrences desc`, span),

    // §10 — login specifically. Only the result code is selected; never a body.
    kusto(`requests
      | where url contains "/api/auth/login"
      | summarize count() by resultCode
      | order by resultCode asc`, span),
  ]);

  const val = (r, d = []) => (r.status === 'fulfilled' ? r.value : d);

  const s = val(summary)[0] || {};
  const total = num(s.total);
  const failed = num(s.failed);
  const failureRate = total ? round((failed / total) * 100, 2) : 0;

  const codes = Object.fromEntries(val(byCode).map((r) => [r.bucket, num(r.count_)]));
  const authCodes = Object.fromEntries(val(auth).map((r) => [String(r.resultCode), num(r.count_)]));
  const authFailures = Object.entries(authCodes)
    .filter(([code]) => Number(code) >= 400)
    .reduce((n, [, c]) => n + c, 0);

  const avgMs = num(s.avgMs);

  return {
    status: failureRate >= 10 || (codes['5xx'] || 0) > 20 ? STATUS.CRITICAL
      : failureRate >= 2 || (codes['5xx'] || 0) > 0 || avgMs > slowMs ? STATUS.WARNING
      : STATUS.HEALTHY,
    configured: true,
    window,
    requests: {
      total,
      successful: total - failed,
      failed,
      failureRate,
      avgResponseTimeMs: avgMs,
      p95ResponseTimeMs: num(s.p95Ms),
    },
    errors: {
      count4xx: codes['4xx'] || 0,
      count5xx: codes['5xx'] || 0,
      topFailingEndpoints: val(topFailing).map((r) => ({
        endpoint: r.name,
        resultCode: String(r.resultCode),
        failures: num(r.failures),
        lastSeen: r.lastSeen,
      })),
      recentExceptions: val(exceptions).map((r) => ({
        type: r.type,
        // Trimmed and never accompanied by a stack trace (§11).
        message: String(r.outerMessage || '').slice(0, 300),
        occurrences: num(r.occurrences),
        lastSeen: r.lastSeen,
      })),
    },
    performance: {
      slowestEndpoints: val(slowest).map((r) => ({
        endpoint: r.name,
        avgMs: num(r.avgMs),
        calls: num(r.calls),
      })),
    },
    authentication: {
      endpoint: '/api/auth/login',
      byResultCode: authCodes,
      total: Object.values(authCodes).reduce((n, c) => n + c, 0),
      failures: authFailures,
      unauthorized401: authCodes['401'] || 0,
      forbidden403: authCodes['403'] || 0,
      rateLimited429: authCodes['429'] || 0,
      serverError500: authCodes['500'] || 0,
    },
    // Surfaced so a partially-failing section is visible rather than silently empty.
    degraded: [summary, byCode, slowest, topFailing, exceptions, auth]
      .filter((r) => r.status === 'rejected').length,
    checkedAt: new Date().toISOString(),
  };
}

/** §11 — the Recent Errors table, filterable by window and class. */
async function getRecentErrors({ window = '24h', kind = 'all' } = {}) {
  if (!isConfigured()) {
    return { configured: false, errors: [], message: 'Application Insights is not configured' };
  }

  const span = TIMESPAN[window] || TIMESPAN['24h'];
  const filter = kind === '5xx' ? '| where toint(resultCode) >= 500'
    : kind === '4xx' ? '| where toint(resultCode) between (400 .. 499)'
    : '| where success == false';

  try {
    const data = await kusto(`requests
      ${filter}
      | summarize occurrences=count(), lastSeen=max(timestamp) by name, resultCode
      | top 50 by lastSeen desc`, span);

    return {
      configured: true,
      window,
      kind,
      errors: data.map((r) => ({
        timestamp: r.lastSeen,
        endpoint: r.name,
        httpStatus: String(r.resultCode),
        type: Number(r.resultCode) >= 500 ? 'Server error' : 'Client error',
        occurrences: num(r.occurrences),
      })),
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { configured: true, errors: [], message: err.message, checkedAt: new Date().toISOString() };
  }
}

module.exports = { isConfigured, configurationReport, getTelemetry, getRecentErrors, TIMESPAN };
