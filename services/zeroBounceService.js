const DEFAULT_ZERO_BOUNCE_BASE_URL = 'https://api.zerobounce.net/v2';

const getApiKey = () => process.env.ZERO_BOUNCE_API_KEY || process.env.ZEROBOUNCE_API_KEY;

const getBaseUrl = () => (
  process.env.ZERO_BOUNCE_API_BASE_URL
  || process.env.ZEROBOUNCE_API_BASE_URL
  || DEFAULT_ZERO_BOUNCE_BASE_URL
).replace(/\/$/, '');

const normalizeEmail = (email = '') => String(email).trim().toLowerCase();

const buildValidateUrl = (email, apiKey) => {
  const url = new URL(`${getBaseUrl()}/validate`);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('email', email);
  url.searchParams.set('ip_address', '');
  url.searchParams.set('timeout', '60');
  url.searchParams.set('activity_data', 'true');

  if (process.env.ZERO_BOUNCE_VERIFY_PLUS === 'true') {
    url.searchParams.set('verify_plus', 'true');
  }

  return url;
};

const validateSingleEmail = async (email, apiKey) => {
  const response = await fetch(buildValidateUrl(email, apiKey), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = response.status === 403
      ? 'ZeroBounce rejected the request. Check ZERO_BOUNCE_API_KEY, account credit balance, and ZERO_BOUNCE_API_BASE_URL region.'
      : payload.error || payload.message || `ZeroBounce validation failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
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

const validateEmailBatch = async (emails) => {
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error('ZERO_BOUNCE_API_KEY is not set in environment variables');
  }

  const uniqueEmails = [...new Set((emails || []).map(normalizeEmail).filter(Boolean))];

  if (uniqueEmails.length === 0) {
    return { results: [], errors: [] };
  }

  const concurrency = Number(process.env.ZERO_BOUNCE_VALIDATION_CONCURRENCY || 5);
  const results = await runWithConcurrency(
    uniqueEmails,
    Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 5,
    (email) => validateSingleEmail(email, apiKey)
  );

  return {
    results,
    errors: []
  };
};

module.exports = {
  validateEmailBatch,
  validateSingleEmail,
  normalizeEmail
};
