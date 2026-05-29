const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

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

  frontendUrl: process.env.FRONTEND_URL,

  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100
  }
};

// ✅ ADD THIS FUNCTION
const validateConfig = () => {
  const requiredVars = ['JWT_SECRET'];

  requiredVars.forEach((key) => {
    if (!process.env[key]) {
      console.error(`⚠ Warning: ${key} is not defined in environment variables.`);
    }
  });

  console.log("✅ Configuration validated");
};

module.exports = { config, validateConfig };