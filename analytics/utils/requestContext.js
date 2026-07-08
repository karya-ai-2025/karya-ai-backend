/**
 * Extracts analytics context from an Express request.
 * Parses the User-Agent for browser/OS/device, resolves IP → country/city
 * (CDN header first, then geoip-lite), derives the product role and session id.
 */

const geoip = require('geoip-lite');

// ── Role: Business / Expert / Admin / Guest ──────────────────────────────────
const getRole = (user) => {
  if (!user) return 'Guest';
  if (user.isAdmin) return 'Admin';
  if (user.activeRole === 'expert') return 'Expert';
  if (user.activeRole === 'owner') return 'Business';
  return 'Guest';
};

const getUserId = (user) => (user ? (user._id || user.id || null) : null);

// ── Client IP (behind proxies / Azure / Cloudflare) ──────────────────────────
const getClientIp = (req) => {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.ip || req.socket?.remoteAddress || '';
};

// ── Country / city from CDN/host headers (no geoip lib) ──────────────────────
const getCountry = (req) =>
  req.headers['cf-ipcountry'] ||
  req.headers['x-appservice-country'] ||
  req.headers['x-country'] ||
  req.headers['x-vercel-ip-country'] ||
  '';

const getCity = (req) =>
  req.headers['x-vercel-ip-city'] ||
  req.headers['x-city'] ||
  '';

// ── Session id (frontend generates + sends it) ───────────────────────────────
const getSessionId = (req) =>
  req.headers['x-session-id'] ||
  req.body?.sessionId ||
  req.cookies?.analyticsSessionId ||
  '';

// ── Lightweight User-Agent parser ────────────────────────────────────────────
const parseUserAgent = (uaRaw = '') => {
  const ua = String(uaRaw);

  let browser = 'Other';
  if (/edg/i.test(ua)) browser = 'Edge';
  else if (/opr|opera/i.test(ua)) browser = 'Opera';
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua)) browser = 'Safari';
  else if (/msie|trident/i.test(ua)) browser = 'Internet Explorer';

  let os = 'Other';
  if (/windows nt/i.test(ua)) os = 'Windows';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/mac os x/i.test(ua)) os = 'macOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/linux/i.test(ua)) os = 'Linux';

  let device = 'desktop';
  if (/mobile|iphone|ipod|android.*mobile/i.test(ua)) device = 'mobile';
  else if (/ipad|tablet|android(?!.*mobile)/i.test(ua)) device = 'tablet';

  return { browser, os, device };
};

// Resolve country/city from an IP via geoip-lite. Localhost / private ranges
// can't be geolocated (returns {}), so this stays blank in local dev.
const geoFromIp = (ip = '') => {
  const clean = String(ip).replace(/^::ffff:/, '').trim();
  if (!clean || clean === '::1' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(clean)) return {};
  const g = geoip.lookup(clean);
  return g ? { country: g.country || '', city: g.city || '' } : {};
};

// One call to build the full context for a request.
const buildContext = (req) => {
  const { browser, os, device } = parseUserAgent(req.headers['user-agent']);
  const ip = getClientIp(req);
  const geo = geoFromIp(ip);
  return {
    user: getUserId(req.user),
    role: getRole(req.user),
    sessionId: getSessionId(req),
    ip,
    country: getCountry(req) || geo.country || '',   // CDN header first, then geoip
    city: getCity(req) || geo.city || '',
    referrer: req.headers['referer'] || req.headers['referrer'] || req.body?.referrer || '',
    browser,
    os,
    device
  };
};

module.exports = {
  getRole,
  getUserId,
  getClientIp,
  getCountry,
  getCity,
  getSessionId,
  parseUserAgent,
  buildContext
};
