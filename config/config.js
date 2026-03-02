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

  email: {
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT, 10) || 587,
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
    from: process.env.EMAIL_FROM || 'noreply@karya-ai.com',
    fromName: process.env.EMAIL_FROM_NAME || 'Karya-AI'
  },

  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

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