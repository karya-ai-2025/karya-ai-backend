const EmailValidation = require('../models/EmailValidation');

const DEFAULT_NEVER_BOUNCE_BASE_URL = 'https://api.neverbounce.com/v4';

// How long a cached validation result stays "fresh" before we re-check (days).
const CACHE_TTL_DAYS = Number(process.env.EMAIL_VALIDATION_TTL_DAYS) > 0
  ? Number(process.env.EMAIL_VALIDATION_TTL_DAYS)
  : 90;

const getApiKey = () => process.env.NEVER_BOUNCE_API_KEY;

const getBaseUrl = () => (
  process.env.NEVER_BOUNCE_API_BASE_URL
  || DEFAULT_NEVER_BOUNCE_BASE_URL
).replace(/\/$/, '');

const normalizeEmail = (email = '') => String(email).trim().toLowerCase();

const buildCheckUrl = (email, apiKey) => {
  const url = new URL(`${getBaseUrl()}/single/check`);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('email', email);

  return url;
};

const mapNeverBounceResult = (email, payload) => ({
  email,
  status: payload.result || 'unknown',
  providerStatus: payload.status || 'unknown',
  subStatus: '',
  did_you_mean: payload.suggested_correction || '',
  flags: Array.isArray(payload.flags) ? payload.flags : [],
  suggested_correction: payload.suggested_correction || '',
  execution_time: payload.execution_time,
  retry_token: payload.retry_token || '',
  raw: payload
});

const validateSingleEmail = async (email, apiKey) => {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.NEVER_BOUNCE_VALIDATION_TIMEOUT_MS || 10000);
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10000);

  try {
    const response = await fetch(buildCheckUrl(email, apiKey), {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      },
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.message || payload.error || `NeverBounce validation failed with status ${response.status}`);
    }

    if (payload.status && payload.status !== 'success') {
      throw new Error(payload.message || payload.error || 'NeverBounce rejected the validation request');
    }

    return mapNeverBounceResult(email, payload);
  } catch (error) {
    if (error.name === 'AbortError') {
      return mapNeverBounceResult(email, {
        status: 'success',
        result: 'unknown',
        flags: ['timeout'],
        suggested_correction: '',
        execution_time: timeoutMs
      });
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const runWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  });

  await Promise.all(workers);
  return results;
};

// ── Cache layer ───────────────────────────────────────────────────────────────

// Look up which of these emails already have a FRESH cached result (< TTL days).
// Returns the cached results keyed by email + the list still needing validation.
// One batched $in query on the unique `email` index — fast even at millions.
const getCachedValidations = async (emails) => {
  const uniqueEmails = [...new Set((emails || []).map(normalizeEmail).filter(Boolean))];
  const cachedMap = {};
  if (uniqueEmails.length === 0) return { cachedMap, toValidate: [] };

  try {
    const freshSince = new Date(Date.now() - CACHE_TTL_DAYS * 864e5);
    const docs = await EmailValidation.find(
      { email: { $in: uniqueEmails }, checkedAt: { $gte: freshSince } },
      { email: 1, status: 1, providerStatus: 1, _id: 0 }
    ).lean();
    docs.forEach((d) => {
      cachedMap[d.email] = { email: d.email, status: d.status, providerStatus: d.providerStatus, cached: true };
    });
  } catch (err) {
    // If the cache lookup fails, don't block — validate everything.
    return { cachedMap: {}, toValidate: uniqueEmails };
  }

  const toValidate = uniqueEmails.filter((e) => !cachedMap[e]);
  return { cachedMap, toValidate };
};

// Validate the given emails against NeverBounce, then upsert the results into the
// cache. Returns the fresh results (mapNeverBounceResult shape + cached:false).
const validateAndCache = async (emails) => {
  const apiKey = getApiKey();
  const uniqueEmails = [...new Set((emails || []).map(normalizeEmail).filter(Boolean))];
  if (uniqueEmails.length === 0) return [];
  if (!apiKey) throw new Error('NEVER_BOUNCE_API_KEY is not set in environment variables');

  const concurrency = Number(process.env.NEVER_BOUNCE_VALIDATION_CONCURRENCY || 5);
  const results = await runWithConcurrency(
    uniqueEmails,
    Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 5,
    (email) => validateSingleEmail(email, apiKey)
  );

  // Persist to cache (upsert per email). A cache-write failure must never break
  // the validation response.
  try {
    const ops = results
      .map((r) => {
        const email = normalizeEmail(r.email);
        if (!email) return null;
        return {
          updateOne: {
            filter: { email },
            update: { $set: { email, status: r.status || 'unknown', providerStatus: r.providerStatus || '', provider: 'neverbounce', checkedAt: new Date() } },
            upsert: true
          }
        };
      })
      .filter(Boolean);
    if (ops.length) await EmailValidation.bulkWrite(ops, { ordered: false });
  } catch (err) {
    console.error('[emailValidation] cache write failed:', err.message);
  }

  return results.map((r) => ({ ...r, cached: false }));
};

// Cache-aware batch: reuse fresh cached results, only hit NeverBounce for the
// rest. Returns results + how many were fresh (charged) vs from cache (free).
const validateEmailBatch = async (emails) => {
  const uniqueEmails = [...new Set((emails || []).map(normalizeEmail).filter(Boolean))];
  if (uniqueEmails.length === 0) return { results: [], errors: [], freshCount: 0, cachedCount: 0 };

  const { cachedMap, toValidate } = await getCachedValidations(uniqueEmails);
  const fresh = toValidate.length ? await validateAndCache(toValidate) : [];

  return {
    results: [...Object.values(cachedMap), ...fresh],
    errors: [],
    freshCount: toValidate.length,
    cachedCount: uniqueEmails.length - toValidate.length
  };
};

module.exports = {
  validateEmailBatch,
  validateSingleEmail,
  getCachedValidations,
  validateAndCache,
  normalizeEmail
};
