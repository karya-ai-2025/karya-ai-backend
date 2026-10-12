// services/infra/azureArm.js
// Azure Resource Manager: subscription, resource health and Cost Management.
//
// Auth order (§20):
//   1. Managed Identity, when the App Service provides IDENTITY_ENDPOINT
//   2. Service principal via AZURE_TENANT_ID / CLIENT_ID / CLIENT_SECRET
//   3. Not configured — every call returns { configured: false } plus the exact
//      RBAC role needed, and the dashboard shows "Unknown / Not configured"
//      rather than inventing a healthy state (§27, §33).
//
// Tokens and secrets never leave this module: they are not returned, not
// logged, and not attached to any error surfaced to the client.

const { STATUS } = require('./probes');

const ARM = 'https://management.azure.com';
const SCOPE = 'https://management.azure.com/.default';

// Cached bearer token. Azure tokens last ~1h; refreshed a minute early.
let tokenCache = { token: null, expiresAt: 0 };

const env = () => ({
  subscriptionId: (process.env.AZURE_SUBSCRIPTION_ID || '').trim(),
  resourceGroup: (process.env.AZURE_RESOURCE_GROUP || '').trim(),
  tenantId: (process.env.AZURE_TENANT_ID || '').trim(),
  clientId: (process.env.AZURE_CLIENT_ID || '').trim(),
  clientSecret: (process.env.AZURE_CLIENT_SECRET || '').trim(),
  identityEndpoint: (process.env.IDENTITY_ENDPOINT || '').trim(),
  identityHeader: (process.env.IDENTITY_HEADER || '').trim(),
});

/** Which auth route is available, without revealing any value. */
function authMode() {
  const e = env();
  if (e.identityEndpoint && e.identityHeader) return 'managed-identity';
  if (e.tenantId && e.clientId && e.clientSecret) return 'service-principal';
  return null;
}

/** Is there enough configuration to call ARM at all? */
function isConfigured() {
  return !!(env().subscriptionId && authMode());
}

/**
 * What exactly is missing — safe to show an admin (§27).
 * Names the variables, never their values.
 */
function configurationReport() {
  const e = env();
  const missing = [];
  if (!e.subscriptionId) missing.push('AZURE_SUBSCRIPTION_ID');
  if (!e.resourceGroup) missing.push('AZURE_RESOURCE_GROUP');
  if (!authMode()) {
    missing.push('Either Managed Identity on the App Service, or AZURE_TENANT_ID + AZURE_CLIENT_ID + AZURE_CLIENT_SECRET');
  }
  return {
    configured: isConfigured(),
    authMode: authMode(),
    missing,
    requiredRoles: [
      { scope: 'Subscription', role: 'Reader', why: 'Subscription state and resource inventory' },
      { scope: 'Subscription', role: 'Cost Management Reader', why: 'Current spend, forecast and cost breakdown' },
      { scope: 'Resource group', role: 'Reader', why: 'Provisioning state and resource health' },
    ],
  };
}

/** Mask an identifier for display — first and last 4 characters only. */
function mask(value) {
  if (!value) return null;
  const s = String(value);
  if (s.length <= 10) return '••••';
  return `${s.slice(0, 4)}••••••••${s.slice(-4)}`;
}

/** Acquire a bearer token. Never logged, never returned to a caller. */
async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;

  const e = env();
  const mode = authMode();
  if (!mode) throw new Error('Azure credentials are not configured');

  let res;
  if (mode === 'managed-identity') {
    const url = `${e.identityEndpoint}?resource=${encodeURIComponent(ARM)}&api-version=2019-08-01`;
    res = await fetch(url, { headers: { 'X-IDENTITY-HEADER': e.identityHeader } });
  } else {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: e.clientId,
      client_secret: e.clientSecret,
      scope: SCOPE,
    });
    res = await fetch(`https://login.microsoftonline.com/${e.tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  if (!res.ok) {
    // Azure echoes the client_id in its error body — never surface it.
    throw new Error(`Azure token request failed (HTTP ${res.status})`);
  }

  const json = await res.json();
  const token = json.access_token;
  const expiresInSec = Number(json.expires_in || json.expires_on || 3600);
  tokenCache = { token, expiresAt: Date.now() + (expiresInSec - 60) * 1000 };
  return token;
}

/** Authenticated ARM GET. Returns parsed JSON or throws a scrubbed error. */
async function arm(path, { method = 'GET', body, timeoutMs = 15000 } = {}) {
  const token = await getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${ARM}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(
        'Azure denied the request. The identity needs Reader on the subscription ' +
        'and Cost Management Reader for billing data.'
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // Azure error bodies can contain identifiers; keep only the code.
      let code = '';
      try { code = JSON.parse(text)?.error?.code || ''; } catch { /* ignore */ }
      throw new Error(`Azure API error (HTTP ${res.status}${code ? ` ${code}` : ''})`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Uniform "not configured" payload — never a fake healthy status. */
const notConfigured = (what) => ({
  status: STATUS.UNKNOWN,
  configured: false,
  message: `Unknown — ${what} requires Azure credentials that are not configured`,
  setup: configurationReport(),
  checkedAt: new Date().toISOString(),
});

/** §5 — subscription state. */
async function getSubscription() {
  if (!isConfigured()) return notConfigured('subscription status');
  const e = env();

  try {
    const sub = await arm(`/subscriptions/${e.subscriptionId}?api-version=2022-12-01`);
    const state = sub.state || 'Unknown';
    return {
      status: state === 'Enabled' ? STATUS.HEALTHY
        : state === 'Warned' ? STATUS.WARNING
        : STATUS.CRITICAL,
      configured: true,
      subscriptionId: mask(e.subscriptionId),
      displayName: sub.displayName || null,
      state,
      resourceGroup: e.resourceGroup || null,
      authMode: authMode(),
      message: state === 'Enabled'
        ? 'Subscription is active'
        : `Subscription state is ${state}`,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      status: STATUS.UNKNOWN,
      configured: true,
      subscriptionId: mask(e.subscriptionId),
      message: `Unable to retrieve Azure subscription information — ${err.message}`,
      checkedAt: new Date().toISOString(),
    };
  }
}

/** §8 — resources in the group with their provisioning state. */
async function getResources() {
  if (!isConfigured()) return notConfigured('resource health');
  const e = env();
  if (!e.resourceGroup) {
    return { ...notConfigured('resource health'), message: 'Unknown — AZURE_RESOURCE_GROUP is not set' };
  }

  try {
    const data = await arm(
      `/subscriptions/${e.subscriptionId}/resourceGroups/${e.resourceGroup}` +
      `/resources?api-version=2021-04-01&$expand=provisioningState`
    );
    const resources = (data.value || []).map((r) => ({
      name: r.name,
      type: r.type,
      region: r.location,
      provisioningState: r.provisioningState || 'Unknown',
      status: r.provisioningState === 'Succeeded' ? STATUS.HEALTHY
        : r.provisioningState ? STATUS.WARNING
        : STATUS.UNKNOWN,
    }));

    const unhealthy = resources.filter((r) => r.status !== STATUS.HEALTHY).length;
    return {
      status: resources.length === 0 ? STATUS.UNKNOWN
        : unhealthy > 0 ? STATUS.WARNING
        : STATUS.HEALTHY,
      configured: true,
      resourceGroup: e.resourceGroup,
      count: resources.length,
      unhealthy,
      resources,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      status: STATUS.UNKNOWN,
      configured: true,
      message: `Unable to retrieve Azure resources — ${err.message}`,
      checkedAt: new Date().toISOString(),
    };
  }
}

/**
 * §6 — month-to-date spend and a daily series, from Cost Management.
 * Currency is whatever Azure reports; never assumed (§6).
 */
async function getCost({ days = 30 } = {}) {
  if (!isConfigured()) return notConfigured('cost data');
  const e = env();

  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth(), 1);
  if (days !== 'month') {
    const d = new Date(to);
    d.setDate(d.getDate() - Number(days));
    if (d > from) from.setTime(d.getTime());
  }

  try {
    const data = await arm(
      `/subscriptions/${e.subscriptionId}/providers/Microsoft.CostManagement/query?api-version=2023-03-01`,
      {
        method: 'POST',
        body: {
          type: 'ActualCost',
          timeframe: 'Custom',
          timePeriod: { from: from.toISOString(), to: to.toISOString() },
          dataset: {
            granularity: 'Daily',
            aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
            grouping: [{ type: 'Dimension', name: 'ServiceName' }],
          },
        },
      }
    );

    const cols = (data.properties?.columns || []).map((c) => c.name);
    const iCost = cols.indexOf('Cost');
    const iDate = cols.indexOf('UsageDate');
    const iService = cols.indexOf('ServiceName');
    const iCurrency = cols.findIndex((c) => /currency/i.test(c));

    const byDay = new Map();
    const byService = new Map();
    let total = 0;
    let currency = null;

    for (const row of data.properties?.rows || []) {
      const amount = Number(row[iCost]) || 0;
      total += amount;
      if (iCurrency >= 0 && !currency) currency = row[iCurrency];

      if (iDate >= 0) {
        const raw = String(row[iDate]);
        const day = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw.slice(0, 10);
        byDay.set(day, (byDay.get(day) || 0) + amount);
      }
      if (iService >= 0) {
        const svc = row[iService] || 'Other';
        byService.set(svc, (byService.get(svc) || 0) + amount);
      }
    }

    const budget = Number(process.env.AZURE_MONTHLY_BUDGET || 0) || null;
    const daily = [...byDay.entries()].sort().map(([date, amount]) => ({ date, amount: round(amount) }));

    // Straight-line projection from month-to-date — labelled as such so it is
    // never mistaken for Azure's own forecast API.
    const dayOfMonth = to.getDate();
    const daysInMonth = new Date(to.getFullYear(), to.getMonth() + 1, 0).getDate();
    const forecast = dayOfMonth > 0 ? round((total / dayOfMonth) * daysInMonth) : null;

    const percentUsed = budget ? round((total / budget) * 100, 1) : null;

    return {
      status: !budget ? STATUS.UNKNOWN
        : percentUsed >= 100 ? STATUS.CRITICAL
        : percentUsed >= 75 ? STATUS.WARNING
        : STATUS.HEALTHY,
      configured: true,
      currency: currency || 'Unknown',
      currentSpend: round(total),
      budget,
      percentUsed,
      forecast,
      forecastMethod: 'Straight-line projection from month-to-date spend',
      daily,
      byService: [...byService.entries()]
        .map(([name, amount]) => ({ name, amount: round(amount) }))
        .sort((a, b) => b.amount - a.amount),
      periodFrom: from.toISOString().slice(0, 10),
      periodTo: to.toISOString().slice(0, 10),
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      status: STATUS.UNKNOWN,
      configured: true,
      message: `Cost data temporarily unavailable — ${err.message}`,
      checkedAt: new Date().toISOString(),
    };
  }
}

const round = (n, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

module.exports = {
  isConfigured,
  configurationReport,
  authMode,
  mask,
  getSubscription,
  getResources,
  getCost,
};
