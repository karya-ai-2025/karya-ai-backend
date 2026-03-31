// middleware/rateLimiter.js
// Rate limiting middleware to prevent abuse

const rateLimit = require('express-rate-limit');
const { config } = require('../config/config');

/**
 * General API rate limiter
 * More lenient in development, stricter in production
 */
const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs, // 15 minutes by default
  max: config.env === 'development' ? 5000 : config.rateLimit.max, // 5000 for dev, 1000 for prod
  message: {
    success: false,
    status: 'error',
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for development environment if needed
    return config.env === 'development' && req.ip === '::1'; // localhost IPv6
  }
});

/**
 * Strict rate limiter for auth endpoints
 * More lenient in development for testing
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.env === 'development' ? 100 : 10, // 100 for dev, 10 for prod
  message: {
    success: false,
    status: 'error',
    message: 'Too many authentication attempts. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true // Don't count successful logins
});

/**
 * Very strict rate limiter for password reset
 */
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 requests per hour
  message: {
    success: false,
    status: 'error',
    message: 'Too many password reset attempts. Please try again after an hour.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Rate limiter for email sending
 */
const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 emails per hour
  message: {
    success: false,
    status: 'error',
    message: 'Too many email requests. Please try again after an hour.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Rate limiter for registration
 */
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 registration attempts per hour
  message: {
    success: false,
    status: 'error',
    message: 'Too many registration attempts. Please try again after an hour.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  apiLimiter,
  authLimiter,
  passwordResetLimiter,
  emailLimiter,
  registrationLimiter
};