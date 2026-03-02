// middleware/authMiddleware.js
// Authentication and authorization middleware

const jwt = require('jsonwebtoken');
const { config } = require('../config/config');
const User = require('../models/User');
const { AppError, asyncHandler } = require('./errorHandler');

/**
 * Protect routes - Verify JWT token
 */
const protect = asyncHandler(async (req, res, next) => {
  let token;
  
  // Check for token in headers or cookies
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    // Get token from header
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies.token) {
    // Get token from cookie
    token = req.cookies.token;
  }
  
  // Check if token exists
  if (!token) {
    return next(
      new AppError('You are not logged in. Please log in to access this resource.', 401)
    );
  }
  
  try {
    // Verify token
    const decoded = jwt.verify(token, config.jwt.secret);
    
    // Check if user still exists
    const user = await User.findById(decoded.id);
    
    if (!user) {
      return next(
        new AppError('The user belonging to this token no longer exists.', 401)
      );
    }
    
    // Check if user is active
    if (!user.isActive) {
      return next(
        new AppError('Your account has been deactivated. Please contact support.', 401)
      );
    }
    
    // Check if user changed password after token was issued
    if (user.changedPasswordAfter(decoded.iat)) {
      return next(
        new AppError('Password was recently changed. Please log in again.', 401)
      );
    }
    
    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    return next(
      new AppError('Invalid token. Please log in again.', 401)
    );
  }
});

/**
 * Optional authentication - Attach user if token exists
 */
const optionalAuth = asyncHandler(async (req, res, next) => {
  let token;
  
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies.token) {
    token = req.cookies.token;
  }
  
  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      const user = await User.findById(decoded.id);
      
      if (user && user.isActive && !user.changedPasswordAfter(decoded.iat)) {
        req.user = user;
      }
    } catch (error) {
      // Token invalid, but that's okay for optional auth
    }
  }
  
  next();
});

/**
 * Restrict access to specific roles
 */
const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to perform this action.', 403)
      );
    }
    next();
  };
};

/**
 * Require email verification
 */
const requireEmailVerification = (req, res, next) => {
  if (!req.user.isEmailVerified) {
    return next(
      new AppError('Please verify your email address to access this resource.', 403)
    );
  }
  next();
};

/**
 * Require onboarding completion
 */
const requireOnboardingComplete = (req, res, next) => {
  if (!req.user.isOnboardingComplete) {
    return next(
      new AppError('Please complete onboarding to access this resource.', 403)
    );
  }
  next();
};

module.exports = {
  protect,
  optionalAuth,
  restrictTo,
  requireEmailVerification,
  requireOnboardingComplete
};