const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), override: true });

const parseOptionalInt = (value) => {
  if (value === undefined || value === '') return undefined;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const parseOptionalFloat = (value) => {
  if (value === undefined || value === '') return undefined;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 5001,
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/karya',

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    expire: process.env.JWT_EXPIRE || '7d',
    cookieExpire: parseInt(process.env.JWT_COOKIE_EXPIRE, 10) || 7
  },

  mailgun: {
    apiKey:    process.env.MAILGUN_API_KEY,
    domain:    process.env.MAILGUN_DOMAIN,
    fromEmail: process.env.MAILGUN_FROM_EMAIL || 'noreply@karya-ai.com',
    fromName:  process.env.MAILGUN_FROM_NAME  || 'Karya-AI',
  },

  // Where email links (Get Started, Verify Email, Login) and OAuth redirects send
  // people when FRONTEND_URL isn't set: the live site in production, the local
  // Next.js dev server otherwise.
  frontendUrl: (
    process.env.FRONTEND_URL ||
    (process.env.NODE_ENV === 'production' ? 'https://www.karya-ai.com' : 'http://localhost:3000')
  ).replace(/\/$/, ''),

  // Role given to an account created through Sign in with LinkedIn / Google when
  // the frontend doesn't pass ?role=. Owner matches email registration; an
  // expert-only frontend sets SOCIAL_LOGIN_DEFAULT_ROLE=expert.
  socialLoginDefaultRole: process.env.SOCIAL_LOGIN_DEFAULT_ROLE === 'expert' ? 'expert' : 'owner',

  // Sign in with LinkedIn (OpenID Connect). redirectUri must exactly match an
  // "Authorized redirect URL" on the LinkedIn app.
  linkedin: {
    clientId: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    redirectUri:
      process.env.LINKEDIN_REDIRECT_URI ||
      `http://localhost:${parseInt(process.env.PORT, 10) || 5001}/api/auth/linkedin/callback`
  },

  // LinkedIn Member Data Portability API (3rd Party) — "Import from LinkedIn".
  // Uses its own LinkedIn app when LINKEDIN_PORTABILITY_* is set, otherwise the
  // sign-in app above (which must then have the portability product added).
  linkedinPortability: {
    clientId: process.env.LINKEDIN_PORTABILITY_CLIENT_ID || process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_PORTABILITY_CLIENT_SECRET || process.env.LINKEDIN_CLIENT_SECRET,
    redirectUri:
      process.env.LINKEDIN_PORTABILITY_REDIRECT_URI ||
      `http://localhost:${parseInt(process.env.PORT, 10) || 5001}/api/auth/linkedin/import/callback`,
    // Snapshot domains to fetch (case sensitive). Profile data only by default —
    // the API also offers private data (INBOX, CONTACTS, CONNECTIONS, SEARCHES…)
    // that we deliberately don't pull. Override with a comma-separated list.
    domains: (
      process.env.LINKEDIN_PORTABILITY_DOMAINS ||
      'PROFILE,POSITIONS,EDUCATION,CERTIFICATIONS,SKILLS,LANGUAGES,COURSES,PROJECTS,PUBLICATIONS,PATENTS,HONORS,ORGANIZATIONS,TEST_SCORES,VOLUNTEERING_EXPERIENCES'
    ).split(',').map((d) => d.trim()).filter(Boolean)
  },

  // Sign in with Google. Separate from GOOGLE_CLIENT_ID/SECRET, which belong to
  // the Meet transcript integration (a different OAuth client).
  google: {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri:
      process.env.GOOGLE_OAUTH_REDIRECT_URI ||
      `http://localhost:${parseInt(process.env.PORT, 10) || 5001}/api/auth/google/callback`
  },

  // Cal.com handles call booking. The booking page itself is embedded by the
  // frontend (NEXT_PUBLIC_CALCOM_LINK); this secret verifies the webhook Cal.com
  // sends to POST /api/scheduling/calcom/webhook when a booking changes.
  calcom: {
    webhookSecret: process.env.CALCOM_WEBHOOK_SECRET
  },

  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    apiVersion: process.env.ANTHROPIC_API_VERSION,
    model: process.env.ANTHROPIC_MODEL,
    maxTokens: parseOptionalInt(process.env.ANTHROPIC_MAX_TOKENS),
    temperature: parseOptionalFloat(process.env.ANTHROPIC_TEMPERATURE),
    timeoutMs: parseOptionalInt(process.env.ANTHROPIC_TIMEOUT_MS),
    maxRetries: parseOptionalInt(process.env.ANTHROPIC_MAX_RETRIES)
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100
  }
};

// ✅ ADD THIS FUNCTION
const validateConfig = () => {
  const requiredVars = [
    'JWT_SECRET',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_API_VERSION',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_MAX_TOKENS',
    'ANTHROPIC_TEMPERATURE',
    'ANTHROPIC_TIMEOUT_MS',
    'ANTHROPIC_MAX_RETRIES'
  ];

  requiredVars.forEach((key) => {
    if (!process.env[key]) {
      console.error(`⚠ Warning: ${key} is not defined in environment variables.`);
    }
  });

  console.log("✅ Configuration validated");

  // TEMPORARY: shout about every testing bypass that is currently on, so none
  // of them can quietly survive into production. Remove with the flags.
  require('./testingFlags').warnIfBypassing();
  require('../middleware/purchaseGuard').warnIfPurchasesOpen();
};

// Frontends allowed to call this API (CORS) and to be redirected back to after OAuth
config.frontendOrigins = [
  ...new Set([
    config.frontendUrl,
    'https://karya-ai.com',
    'https://www.karya-ai.com',
    'https://acerstone.com',
    'https://www.acerstone.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ])
];

module.exports = { config, validateConfig };
