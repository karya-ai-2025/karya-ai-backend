// middleware/authMiddleware.js
// Authentication and authorization middleware

const jwt = require('jsonwebtoken');
const { config } = require('../config/config');
const User = require('../models/User');
const { AppError, asyncHandler } = require('./errorHandler');
const { resolveOrgContext } = require('./orgContext');
const { isBlockedExpert, moveOffExpertRole, expertFlowPausedError } = require('../config/featureFlags');

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

    // The token says which kind of account it was issued to. It must still
    // be that account's kind — a token from before the kinds existed, or one
    // that doesn't match, is sent back to log in.
    if (decoded.kind !== user.kind) {
      return next(new AppError('Your session has expired. Please log in again.', 401));
    }
    
    // Attach user to request
    req.user = user;
  } catch (error) {
    return next(
      new AppError('Invalid token. Please log in again.', 401)
    );
  }

  // Expert flow switched off: a session still signed in as an expert either
  // moves back to its business side or, with none, is refused outright.
  if (isBlockedExpert(req.user)) return next(expertFlowPausedError());
  if (moveOffExpertRole(req.user)) await req.user.save({ validateBeforeSave: false });

  // Work out which organization they act in and what their role allows.
  // Outside the try above
  // so a withdrawn membership surfaces as its own 403, not "invalid token".
  await resolveOrgContext(req);
  next();
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
      
      if (user && user.isActive && !user.changedPasswordAfter(decoded.iat)
          && decoded.kind === user.kind && !isBlockedExpert(user)) {
        req.user = user;
        await resolveOrgContext(req);
      }
    } catch (error) {
      // Token invalid, or a member whose access was withdrawn —
      // either way they are treated as signed out for optional auth.
      req.user = undefined;
    }
  }
  
  next();
});

/**
 * Read the token from the request, if there is one. Header first, then cookie.
 */
const tokenFrom = (req) => {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    return req.headers.authorization.split(' ')[1];
  }
  return req.cookies && req.cookies.token;
};

const KIND_LABEL = { business: 'business', partner: 'partner', platform: 'Karya team' };

/**
 * Keep every other kind of account out of an API area. Mounted in front of a
 * whole area in index.js:
 *
 *     app.use('/api/campaigns', kindGate('business'), campaignRoutes)
 *
 * It only reads the kind signed into the token, so it costs no database
 * query; `protect` inside the area then checks that kind against the account
 * itself. Requests with no token (or a broken one) pass through untouched, so
 * the area's public routes keep working and `protect` gives its usual answer.
 */
const kindGate = (...kinds) => (req, res, next) => {
  const token = tokenFrom(req);
  if (!token) return next();

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
  } catch {
    return next();
  }

  if (!kinds.includes(decoded.kind)) {
    const area = kinds.map((k) => KIND_LABEL[k] || k).join(' / ');
    return next(new AppError(`This part of Karya is only for ${area} accounts.`, 403));
  }
  return next();
};

/** Same rule after `protect`, against the account itself. */
const requireKind = (...kinds) => (req, res, next) => {
  if (!req.user || !kinds.includes(req.user.kind)) {
    return next(new AppError('Your account cannot use this part of Karya.', 403));
  }
  return next();
};

/**
 * Restrict access to specific roles.
 * isAdmin: true always passes through regardless of activeRole.
 */
const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (req.user.isAdmin) return next();
    if (!roles.includes(req.user.activeRole)) {
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

/**
 * Demo accounts are shared walkthrough logins — keep them from changing their
 * own credentials or anything else the next visitor would inherit.
 */
const blockDemo = (req, res, next) => {
  if (req.user?.isDemo) {
    return next(new AppError('This action is not available on a demo account.', 403));
  }
  next();
};

module.exports = {
  protect,
  kindGate,
  requireKind,
  blockDemo,
  optionalAuth,
  restrictTo,
  requireEmailVerification,
  requireOnboardingComplete
};