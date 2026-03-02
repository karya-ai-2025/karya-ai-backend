// utils/generateToken.js
// JWT token generation and cookie setting utilities

const { config } = require('../config/config');

/**
 * Generate JWT token and set it as HTTP-only cookie
 * @param {Object} user - User document
 * @param {number} statusCode - HTTP status code
 * @param {Object} res - Express response object
 * @param {string} message - Success message
 */
const sendTokenResponse = (user, statusCode, res, message = 'Success') => {
  // Generate token
  const token = user.generateAuthToken();
  
  // Cookie options
  const cookieOptions = {
    expires: new Date(
      Date.now() + config.jwt.cookieExpire * 24 * 60 * 60 * 1000
    ),
    httpOnly: true, // Can't be accessed by JavaScript
    secure: config.env === 'production', // Only HTTPS in production
    sameSite: config.env === 'production' ? 'strict' : 'lax',
    path: '/'
  };
  
  // Remove sensitive data from user object
  const userResponse = user.toJSON();
  
  res
    .status(statusCode)
    .cookie('token', token, cookieOptions)
    .json({
      success: true,
      message,
      token, // Also send in body for mobile apps
      user: userResponse
    });
};

/**
 * Clear token cookie (logout)
 * @param {Object} res - Express response object
 */
const clearTokenCookie = (res) => {
  res.cookie('token', 'none', {
    expires: new Date(Date.now() + 10 * 1000), // 10 seconds
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: config.env === 'production' ? 'strict' : 'lax'
  });
};

module.exports = {
  sendTokenResponse,
  clearTokenCookie
};