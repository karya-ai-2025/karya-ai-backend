// routes/authRoutes.js
// Authentication routes with multi-profile support

const express = require('express');
const router = express.Router();

// Controllers
const {
  register,
  login,
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

// Middleware
const { protect } = require('../middleware/authMiddleware');
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
router.post('/create-profile', protect, createProfile);

// Update core profile
router.put(
  '/update-profile',
  protect,
  updateProfileValidation,
  validateRequest,
  updateProfile
);

// Change password
router.put(
  '/change-password',
  protect,
  changePasswordValidation,
  validateRequest,
  changePassword
);

// Deactivate account
router.delete('/deactivate', protect, deactivateAccount);

module.exports = router;