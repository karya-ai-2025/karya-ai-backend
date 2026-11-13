const { body, param } = require('express-validator');

// Signup fields, shared by business and partner signup
const fullNameRule = body('fullName')
  .trim()
  .notEmpty().withMessage('Full name is required')
  .isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters');

const emailRule = body('email')
  .trim()
  .notEmpty().withMessage('Email is required')
  .isEmail().withMessage('Please provide a valid email address')
  .normalizeEmail();

const passwordRule = body('password')
  .notEmpty().withMessage('Password is required')
  .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
  .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number');

const roleRule = body('role')
  .optional()
  .isIn(['owner', 'expert']).withMessage('Role must be owner or expert');

const inviteTokenRule = body('inviteToken')
  .optional()
  .isHexadecimal().withMessage('Invalid invitation link')
  .isLength({ min: 64, max: 64 }).withMessage('Invalid invitation link');

const phoneRule = body('phone')
  .optional()
  .trim()
  .matches(/^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/)
  .withMessage('Please provide a valid phone number');

const companyRule = body('company')
  .optional()
  .trim()
  .isLength({ max: 100 }).withMessage('Company name cannot exceed 100 characters')
  // A business signup creates the company's organization from this name.
  // (Joining by invitation uses the inviting company's.)
  .custom((value, { req }) => {
    const isBusinessSignup = !req.body.inviteToken && req.body.role !== 'expert';
    if (isBusinessSignup && String(value || '').trim().length < 2) {
      throw new Error('Company name is required');
    }
    return true;
  });

const registerValidation = [fullNameRule, emailRule, passwordRule, roleRule, inviteTokenRule, phoneRule, companyRule];

const loginValidation = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required'),
  body('role')
    .optional()
    .isIn(['owner', 'expert']).withMessage('Role must be owner or expert')
];

const forgotPasswordValidation = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail()
];

const resetPasswordValidation = [
  param('token')
    .notEmpty().withMessage('Reset token is required'),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number')
];

const changePasswordValidation = [
  body('currentPassword')
    .notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .notEmpty().withMessage('New password is required')
    .isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number')
    .custom((value, { req }) => {
      if (value === req.body.currentPassword) {
        throw new Error('New password must be different from current password');
      }
      return true;
    })
];

const verifyEmailValidation = [
  param('token')
    .notEmpty().withMessage('Verification token is required')
];

const resendVerificationValidation = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail()
];

const updateProfileValidation = [
  body('fullName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters'),
  body('phone')
    .optional()
    .trim()
    .matches(/^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/)
    .withMessage('Please provide a valid phone number'),
  body('avatar')
    .optional()
    .isURL().withMessage('Avatar must be a valid URL')
];

// Partner (agency) signup: the same person fields, and the agency name.
const registerPartnerValidation = [
  fullNameRule, emailRule, passwordRule, phoneRule,
  body('company')
    .trim()
    .notEmpty().withMessage('Agency name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Agency name must be between 2 and 100 characters'),
];

module.exports = {
  registerValidation,
  registerPartnerValidation,
  loginValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
  changePasswordValidation,
  verifyEmailValidation,
  resendVerificationValidation,
  updateProfileValidation
};
