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
  port: parseInt(process.env.PORT, 10) || 5000,
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

  // Falls back to the production site so email links (Get Started, Verify Email,
  // Login) are never broken if FRONTEND_URL isn't set on the host.
  frontendUrl: process.env.FRONTEND_URL || 'https://www.karya-ai.com',

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
};

module.exports = { config, validateConfig };
