// routes/authRoutes.js
// Authentication routes with multi-profile support

const express = require('express');
const router = express.Router();

// Controllers
const {
  register,
  login,
  demoLogin,
  logout,
  getMe,
  switchRole,
  createProfile,
  forgotPassword,
  resetPassword,
  changePassword,
  verifyEmail,
  resendVerification,
  updateProfile,
  checkEmail,
  deactivateAccount,
  getProfiles
} = require('../controllers/authController');
const socialAuth = require('../controllers/socialAuthController');
const { linkedInImportCallback } = require('../controllers/linkedinImportController');

// Middleware
const { protect, blockDemo } = require('../middleware/authMiddleware');
const validateRequest = require('../middleware/validateRequest');
const {
  authLimiter,
  passwordResetLimiter,
  emailLimiter,
  registrationLimiter
} = require('../middleware/rateLimiter');

// Validators
const {
  registerValidation,
  loginValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
  changePasswordValidation,
  verifyEmailValidation,
  resendVerificationValidation,
  updateProfileValidation
} = require('../validators/authValidators');

// ============================================
// PUBLIC ROUTES
// ============================================

// Register new user
router.post(
  '/register',
  registrationLimiter,
  registerValidation,
  validateRequest,
  register
);

// Login
router.post(
  '/login',
  authLimiter,
  loginValidation,
  validateRequest,
  login
);

// Demo (walkthrough) accounts sign in with a login ID instead of an email
router.post('/demo-login', authLimiter, demoLogin);

// Sign in with LinkedIn / Google (OpenID Connect) — browser redirects, not fetch calls
router.get('/linkedin', authLimiter, socialAuth.linkedin.start);
router.get('/linkedin/callback', authLimiter, socialAuth.linkedin.callback);
// LinkedIn data import consent lands here (see linkedinImportController)
router.get('/linkedin/import/callback', authLimiter, linkedInImportCallback);
router.get('/google', authLimiter, socialAuth.google.start);
router.get('/google/callback', authLimiter, socialAuth.google.callback);

// Check if email exists
router.post('/check-email', checkEmail);

// Forgot password
router.post(
  '/forgot-password',
  passwordResetLimiter,
  forgotPasswordValidation,
  validateRequest,
  forgotPassword
);

// Reset password
router.put(
  '/reset-password/:token',
  resetPasswordValidation,
  validateRequest,
  resetPassword
);

// Verify email
router.get(
  '/verify-email/:token',
  verifyEmailValidation,
  validateRequest,
  verifyEmail
);

// Resend verification email
router.post(
  '/resend-verification',
  emailLimiter,
  resendVerificationValidation,
  validateRequest,
  resendVerification
);

// ============================================
// PROTECTED ROUTES
// ============================================

// Logout
router.post('/logout', protect, logout);

// Get current user
router.get('/me', protect, getMe);

// Get all profiles
router.get('/profiles', protect, getProfiles);

// Switch between roles
router.post('/switch-role', protect, switchRole);

// Create additional profile (owner/expert)
router.post('/create-profile', protect, blockDemo, createProfile);

// Update core profile
router.put(
  '/update-profile',
  protect,
  blockDemo,
  updateProfileValidation,
  validateRequest,
  updateProfile
);

// Change password
router.put(
  '/change-password',
  protect,
  blockDemo,
  changePasswordValidation,
  validateRequest,
  changePassword
);

// Deactivate account
router.delete('/deactivate', protect, blockDemo, deactivateAccount);

module.exports = router;