// services/infra/cache.js
// Tiny in-process TTL cache for infrastructure probes.
//
// The dashboard must not hammer Azure, DNS and the live sites on every render
// (§21). Each probe declares its own TTL; a forced refresh bypasses the cache
// but still writes the fresh value back so subsequent renders stay cheap.
//
// In-process is deliberate: this is a read cache for a single admin screen, so
// a per-instance copy is fine and it adds no infrastructure. It resets on
// deploy, which is the correct behaviour — a restart should re-probe.

const store = new Map();

/**
 * Run `fn` behind a TTL cache.
 *
 * @param {string} key
 * @param {number} ttlMs   how long a value stays fresh
 * @param {Function} fn    async producer; only called on miss or force
 * @param {boolean} force  bypass the cached value
 */
async function cached(key, ttlMs, fn, force = false) {
  const hit = store.get(key);
  const now = Date.now();

  if (!force && hit && now - hit.at < ttlMs) {
    return { ...hit.value, _cachedAt: new Date(hit.at).toISOString(), _fromCache: true };
  }

  const value = await fn();
  store.set(key, { at: now, value });
  return { ...value, _cachedAt: new Date(now).toISOString(), _fromCache: false };
}

/** Newest cache write across the given keys — drives "Last updated". */
function newestWrite(keys = []) {
  const times = keys.map((k) => store.get(k)?.at).filter(Boolean);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

function clear() {
  store.clear();
}

// TTLs per §21.
const TTL = {
  BACKEND: 60 * 1000,
  FRONTEND: 60 * 1000,
  DATABASE: 30 * 1000,
  DNS: 5 * 60 * 1000,
  APP_INSIGHTS: 3 * 60 * 1000,
  AZURE_COST: 10 * 60 * 1000,
  AZURE_RESOURCES: 3 * 60 * 1000,
  AZURE_SUBSCRIPTION: 10 * 60 * 1000,
};

module.exports = { cached, newestWrite, clear, TTL };
