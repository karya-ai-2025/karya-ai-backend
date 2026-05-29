const DEFAULT_NEVER_BOUNCE_BASE_URL = 'https://api.neverbounce.com/v4';

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

const validateEmailBatch = async (emails) => {
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error('NEVER_BOUNCE_API_KEY is not set in environment variables');
  }

  const uniqueEmails = [...new Set((emails || []).map(normalizeEmail).filter(Boolean))];

  if (uniqueEmails.length === 0) {
    return { results: [], errors: [] };
  }

  const concurrency = Number(process.env.NEVER_BOUNCE_VALIDATION_CONCURRENCY || 5);
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
