// services/infra/index.js
// Assembles the infrastructure overview (§19).
//
// Every subsystem is probed independently through Promise.allSettled and its
// own cache entry, so one failure degrades a single card rather than the page
// (§26). Nothing here returns a credential, and no value is invented: an
// unavailable subsystem reports "unknown", never "healthy".

const { STATUS, httpProbe, dnsProbe, certificateProbe, databaseProbe } = require('./probes');
const { cached, newestWrite, TTL } = require('./cache');
const azureArm = require('./azureArm');
const appInsights = require('./appInsights');

/** Targets, from configuration — never hardcoded when a variable exists (§9, §13). */
function targets() {
  const backendUrl =
    (process.env.BACKEND_URL || '').trim() ||
    (process.env.BACKEND_PUBLIC_URL || '').trim() ||
    null;

  const frontendUrl = (process.env.FRONTEND_URL || '').trim() || null;
  const staticWebAppUrl = (process.env.AZURE_STATIC_WEB_APP_URL || '').trim() || null;

  // Domains to watch: derived from FRONTEND_URL so there is one source of truth,
  // plus anything explicitly listed.
  const explicit = (process.env.MONITORED_DOMAINS || '')
    .split(',').map((d) => d.trim()).filter(Boolean);

  let derived = [];
  if (frontendUrl) {
    try {
      const host = new URL(frontendUrl).hostname;
      derived = host.startsWith('www.') ? [host, host.slice(4)] : [host, `www.${host}`];
    } catch { /* malformed FRONTEND_URL — ignored */ }
  }

  return {
    backendUrl,
    frontendUrl,
    staticWebAppUrl,
    domains: [...new Set([...explicit, ...derived])],
  };
}

/** Worst status wins, so a single critical subsystem is never hidden by green. */
function rollUp(statuses) {
  if (statuses.includes(STATUS.CRITICAL)) return STATUS.CRITICAL;
  if (statuses.includes(STATUS.WARNING)) return STATUS.WARNING;
  if (statuses.every((s) => s === STATUS.UNKNOWN)) return STATUS.UNKNOWN;
  return statuses.includes(STATUS.UNKNOWN) ? STATUS.WARNING : STATUS.HEALTHY;
}

/** A rejected probe becomes an unknown card, never a thrown request. */
const settled = (r, label) =>
  r.status === 'fulfilled'
    ? r.value
    : {
        status: STATUS.UNKNOWN,
        message: `${label} check failed: ${r.reason?.message || 'unknown error'}`,
        checkedAt: new Date().toISOString(),
      };

/** §13 — the Azure URL and the production domain, reported separately. */
async function frontendHealth(t, force) {
  const [azure, production] = await Promise.allSettled([
    t.staticWebAppUrl
      ? cached('fe:azure', TTL.FRONTEND, () => httpProbe(t.staticWebAppUrl), force)
      : Promise.resolve({ status: STATUS.UNKNOWN, message: 'No AZURE_STATIC_WEB_APP_URL configured' }),
    t.frontendUrl
      ? cached('fe:prod', TTL.FRONTEND, () => httpProbe(t.frontendUrl), force)
      : Promise.resolve({ status: STATUS.UNKNOWN, message: 'No FRONTEND_URL configured' }),
  ]);

  const a = settled(azure, 'Azure frontend');
  const p = settled(production, 'Production domain');
  return { status: rollUp([a.status, p.status]), azure: a, production: p };
}

/** §14 — DNS, certificate and HTTPS reachability per domain. */
async function domainHealth(t, force) {
  if (!t.domains.length) {
    return {
      status: STATUS.UNKNOWN,
      message: 'No domains configured. Set FRONTEND_URL or MONITORED_DOMAINS.',
      domains: [],
    };
  }

  const results = await Promise.allSettled(
    t.domains.map((host) =>
      cached(`dns:${host}`, TTL.DNS, async () => {
        const dnsResult = await dnsProbe(host);
        // Only attempt TLS when the name resolves — otherwise the failure is
        // just the DNS failure repeated, which reads as two problems.
        const cert = dnsResult.resolves
          ? await certificateProbe(host)
          : { status: STATUS.UNKNOWN, message: 'Not checked — hostname does not resolve' };
        const http = dnsResult.resolves
          ? await httpProbe(`https://${host}`)
          : { status: STATUS.UNKNOWN, message: 'Not checked — hostname does not resolve' };

        return {
          hostname: host,
          status: rollUp([dnsResult.status, cert.status, http.status]),
          dns: dnsResult,
          certificate: cert,
          https: http,
        };
      }, force)
    )
  );

  const domains = results.map((r, i) => settled(r, `Domain ${t.domains[i]}`));
  return { status: rollUp(domains.map((d) => d.status)), domains };
}

/**
 * §19 — the whole picture in one structured response.
 * @param {{force?: boolean, window?: string}} opts
 */
async function getOverview({ force = false, window = '24h' } = {}) {
  const t = targets();

  const [backend, frontend, database, domains, telemetry, subscription, cost, resources] =
    await Promise.allSettled([
      t.backendUrl
        ? cached('backend', TTL.BACKEND, () => httpProbe(`${t.backendUrl.replace(/\/$/, '')}/api/health`), force)
        : Promise.resolve({
            status: STATUS.UNKNOWN,
            message: 'No BACKEND_URL configured — set it to the public API base URL',
          }),
      frontendHealth(t, force),
      cached('database', TTL.DATABASE, () => databaseProbe(), force),
      domainHealth(t, force),
      cached(`ai:${window}`, TTL.APP_INSIGHTS, () => appInsights.getTelemetry({ window }), force),
      cached('az:sub', TTL.AZURE_SUBSCRIPTION, () => azureArm.getSubscription(), force),
      cached('az:cost', TTL.AZURE_COST, () => azureArm.getCost(), force),
      cached('az:res', TTL.AZURE_RESOURCES, () => azureArm.getResources(), force),
    ]);

  const sections = {
    backend: settled(backend, 'Backend'),
    frontend: settled(frontend, 'Frontend'),
    database: settled(database, 'Database'),
    domains: settled(domains, 'Domains'),
    applicationInsights: settled(telemetry, 'Application Insights'),
    subscription: settled(subscription, 'Azure subscription'),
    cost: settled(cost, 'Azure cost'),
    resources: settled(resources, 'Azure resources'),
  };

  return {
    timestamp: new Date().toISOString(),
    lastUpdated: newestWrite([
      'backend', 'fe:azure', 'fe:prod', 'database',
      `ai:${window}`, 'az:sub', 'az:cost', 'az:res',
    ]),
    overallStatus: rollUp(Object.values(sections).map((s) => s.status)),
    // What is wired up, so the UI can explain gaps instead of showing blanks (§27).
    integrations: {
      azureArm: azureArm.configurationReport(),
      applicationInsights: appInsights.configurationReport(),
      targets: {
        backendUrl: t.backendUrl,
        frontendUrl: t.frontendUrl,
        staticWebAppUrl: t.staticWebAppUrl,
        domains: t.domains,
      },
    },
    ...sections,
  };
}

module.exports = { getOverview, targets, rollUp, STATUS };
