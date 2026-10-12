// services/infra/probes.js
// Direct availability checks: HTTP endpoints, DNS, TLS certificates, MongoDB.
//
// These need no Azure credentials, so they work in every environment. Each
// returns a uniform { status, ... } shape and never throws — a failed probe is
// a result, not an exception, so one dead subsystem cannot take the dashboard
// down (§26).

const dns = require('dns').promises;
const tls = require('tls');
const mongoose = require('mongoose');

// §4 status vocabulary. No invented health scores.
const STATUS = {
  HEALTHY: 'healthy',
  WARNING: 'warning',
  CRITICAL: 'critical',
  UNKNOWN: 'unknown',
};

/**
 * Fetch a URL and report availability.
 *
 * A redirect is followed so a domain that 301s to https still reads as up, and
 * the final URL is reported so an unexpected redirect target is visible.
 */
async function httpProbe(url, { timeoutMs = 10000, warnMs = 2000 } = {}) {
  if (!url) {
    return { status: STATUS.UNKNOWN, url: null, message: 'No URL configured' };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'KaryaAI-InfraMonitor/1.0' },
    });
    const responseTimeMs = Date.now() - started;

    let status = STATUS.HEALTHY;
    let message = 'Reachable';
    if (res.status >= 500) {
      status = STATUS.CRITICAL;
      message = `Server error (HTTP ${res.status})`;
    } else if (res.status >= 400) {
      status = STATUS.WARNING;
      message = `HTTP ${res.status}`;
    } else if (responseTimeMs > warnMs) {
      status = STATUS.WARNING;
      message = `Slow response (${responseTimeMs}ms)`;
    }

    return {
      status,
      url,
      httpStatus: res.status,
      responseTimeMs,
      finalUrl: res.url !== url ? res.url : undefined,
      redirected: res.redirected || undefined,
      message,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    // Separate "cannot resolve the name" from "resolved but refused", because
    // they point at completely different problems. Node's fetch reports a bare
    // "fetch failed" and hides the real reason on err.cause, so check both.
    const detail = `${err.message} ${err.cause?.message || ''} ${err.cause?.code || ''}`;
    const dnsFailure = /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(detail);
    return {
      status: STATUS.CRITICAL,
      url,
      httpStatus: null,
      responseTimeMs: Date.now() - started,
      message: err.name === 'AbortError'
        ? `No response within ${timeoutMs}ms`
        : dnsFailure
          ? 'Hostname does not resolve (DNS)'
          : `Unreachable: ${err.cause?.message || err.message}`,
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a hostname and report what actually exists in DNS.
 *
 * Reports only what the lookup returns — §14 forbids claiming a record is
 * wrong unless the lookup confirms it, so expectations are compared, never
 * assumed.
 */
async function dnsProbe(hostname, { expectCname } = {}) {
  if (!hostname) {
    return { status: STATUS.UNKNOWN, hostname: null, message: 'No hostname configured' };
  }

  const out = {
    hostname,
    a: [],
    cname: [],
    ns: [],
    mx: [],
    checkedAt: new Date().toISOString(),
  };

  const settle = async (fn) => { try { return await fn(); } catch { return []; } };

  // dns.lookup uses the OS resolver and follows CNAME chains, so it answers the
  // real question: can a browser reach this name? The record-type queries below
  // are detail only — dns.resolve4 does NOT follow CNAMEs, so an Azure host that
  // works perfectly returns no A record and must not be called broken.
  let resolvedAddress = null;
  try {
    const { address } = await dns.lookup(hostname);
    resolvedAddress = address;
  } catch { /* stays null — reported as not resolving */ }

  const [a, cname, ns, mx] = await Promise.all([
    settle(() => dns.resolve4(hostname)),
    settle(() => dns.resolveCname(hostname)),
    settle(() => dns.resolveNs(hostname)),
    settle(() => dns.resolveMx(hostname)),
  ]);

  out.a = a;
  out.cname = cname;
  out.ns = ns;
  out.mx = (mx || []).map((r) => `${r.exchange} (${r.priority})`);
  out.resolvedAddress = resolvedAddress;

  const resolves = !!resolvedAddress;

  if (!resolves) {
    return {
      ...out,
      status: STATUS.CRITICAL,
      resolves: false,
      message: out.ns.length
        ? 'Nameservers exist but the host has no A or CNAME record'
        : 'Domain does not resolve (NXDOMAIN) — check registration and nameservers',
    };
  }

  // Only flagged when an expectation was supplied AND the lookup disagrees.
  if (expectCname && out.cname.length && !out.cname.some((c) => c.includes(expectCname))) {
    return {
      ...out,
      status: STATUS.WARNING,
      resolves: true,
      message: `CNAME is ${out.cname[0]}, expected it to include ${expectCname}`,
    };
  }

  return { ...out, status: STATUS.HEALTHY, resolves: true, message: 'Resolves' };
}

/** Read the TLS certificate and report how long it has left. */
async function certificateProbe(hostname, { timeoutMs = 10000 } = {}) {
  if (!hostname) {
    return { status: STATUS.UNKNOWN, message: 'No hostname configured' };
  }

  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };

    const socket = tls.connect(
      { host: hostname, port: 443, servername: hostname, timeout: timeoutMs },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();

        if (!cert || !cert.valid_to) {
          return done({ status: STATUS.UNKNOWN, message: 'No certificate returned' });
        }

        const expiresAt = new Date(cert.valid_to);
        const daysLeft = Math.floor((expiresAt - Date.now()) / 86400000);

        done({
          status: daysLeft < 0 ? STATUS.CRITICAL
            : daysLeft < 14 ? STATUS.WARNING
            : STATUS.HEALTHY,
          issuer: cert.issuer?.O || cert.issuer?.CN || 'Unknown',
          validTo: expiresAt.toISOString(),
          daysRemaining: daysLeft,
          message: daysLeft < 0
            ? 'Certificate has expired'
            : `Valid for ${daysLeft} more day(s)`,
          checkedAt: new Date().toISOString(),
        });
      }
    );

    socket.on('error', (err) => done({
      status: STATUS.CRITICAL,
      message: /ENOTFOUND|EAI_AGAIN/i.test(err.message)
        ? 'Hostname does not resolve, so HTTPS cannot be checked'
        : `TLS failed: ${err.message}`,
      checkedAt: new Date().toISOString(),
    }));

    socket.on('timeout', () => {
      socket.destroy();
      done({ status: STATUS.CRITICAL, message: 'TLS handshake timed out' });
    });
  });
}

/**
 * MongoDB health, using the connection the app already holds (§12).
 * No new connection is opened and the URI is never returned.
 */
async function databaseProbe({ warnMs = 500 } = {}) {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const readyState = mongoose.connection.readyState;

  if (readyState !== 1) {
    return {
      status: STATUS.CRITICAL,
      connected: false,
      state: states[readyState] || 'unknown',
      message: `MongoDB is ${states[readyState] || 'in an unknown state'}`,
      checkedAt: new Date().toISOString(),
    };
  }

  const started = Date.now();
  try {
    await mongoose.connection.db.admin().ping();
    const responseTimeMs = Date.now() - started;
    return {
      status: responseTimeMs > warnMs ? STATUS.WARNING : STATUS.HEALTHY,
      connected: true,
      state: 'connected',
      responseTimeMs,
      // Host only — never the URI, which carries credentials.
      host: mongoose.connection.host || undefined,
      database: mongoose.connection.name || undefined,
      message: responseTimeMs > warnMs
        ? `Connected but slow (${responseTimeMs}ms)`
        : 'Connected',
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      status: STATUS.CRITICAL,
      connected: false,
      state: 'error',
      message: `Ping failed: ${err.message}`,
      checkedAt: new Date().toISOString(),
    };
  }
}

module.exports = { STATUS, httpProbe, dnsProbe, certificateProbe, databaseProbe };
