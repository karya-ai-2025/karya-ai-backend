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

  email: {
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT, 10) || 587,
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
    from: process.env.EMAIL_FROM || 'noreply@karya-ai.com',
    fromName: process.env.EMAIL_FROM_NAME || 'Karya-AI'
  },

  frontendUrl: process.env.FRONTEND_URL,

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
