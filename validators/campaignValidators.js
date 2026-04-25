const { body, param, query, validationResult } = require('express-validator');

// Middleware to check validation results
const checkValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// Campaign validation rules
const validateCreateCampaign = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Campaign name must be between 2 and 100 characters'),

  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters'),

  body('emailTemplateId')
    .isMongoId()
    .withMessage('Invalid email template ID'),

  body('selectedLeads')
    .isArray({ min: 1 })
    .withMessage('At least one lead must be selected'),

  body('selectedLeads.*.email')
    .isEmail()
    .withMessage('Invalid email address'),

  body('selectedLeads.*.leadId')
    .notEmpty()
    .withMessage('Lead ID is required'),

  body('settings.sendingRate')
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage('Sending rate must be between 1 and 500 emails per hour'),

  body('settings.followUpDelayHours')
    .optional()
    .isInt({ min: 1, max: 720 })
    .withMessage('Follow-up delay must be between 1 and 720 hours'),

  body('scheduledAt')
    .optional()
    .isISO8601()
    .withMessage('Invalid scheduled date format'),

  checkValidation
];

const validateUpdateCampaign = [
  param('id')
    .isMongoId()
    .withMessage('Invalid campaign ID'),

  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Campaign name must be between 2 and 100 characters'),

  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters'),

  body('emailTemplateId')
    .optional()
    .isMongoId()
    .withMessage('Invalid email template ID'),

  body('selectedLeads')
    .optional()
    .isArray({ min: 1 })
    .withMessage('At least one lead must be selected'),

  body('settings.sendingRate')
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage('Sending rate must be between 1 and 500 emails per hour'),

  checkValidation
];

const validateCampaignId = [
  param('id')
    .isMongoId()
    .withMessage('Invalid campaign ID'),

  checkValidation
];

const validateGetCampaigns = [
  query('status')
    .optional()
    .isIn(['draft', 'scheduled', 'sending', 'completed', 'paused', 'failed'])
    .withMessage('Invalid status filter'),

  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),

  checkValidation
];

// Email Template validation rules
const validateCreateEmailTemplate = [
  body('templateName')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Template name must be between 2 and 100 characters'),

  body('subject')
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage('Subject must be between 1 and 500 characters'),

  body('emailBody')
    .trim()
    .isLength({ min: 1, max: 50000 })
    .withMessage('Email body must be between 1 and 50,000 characters'),

  body('templateType')
    .optional()
    .isIn(['campaign', 'follow-up', 'welcome', 'newsletter', 'promotional', 'transactional'])
    .withMessage('Invalid template type'),

  body('category')
    .optional()
    .isIn(['sales', 'marketing', 'support', 'onboarding', 'follow-up', 'general'])
    .withMessage('Invalid category'),

  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array'),

  checkValidation
];

const validateUpdateEmailTemplate = [
  param('id')
    .isMongoId()
    .withMessage('Invalid template ID'),

  body('templateName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Template name must be between 2 and 100 characters'),

  body('subject')
    .optional()
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage('Subject must be between 1 and 500 characters'),

  body('emailBody')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50000 })
    .withMessage('Email body must be between 1 and 50,000 characters'),

  checkValidation
];

const validateTemplateId = [
  param('id')
    .isMongoId()
    .withMessage('Invalid template ID'),

  checkValidation
];

const validateGetEmailTemplates = [
  query('category')
    .optional()
    .isIn(['sales', 'marketing', 'support', 'onboarding', 'follow-up', 'general'])
    .withMessage('Invalid category filter'),

  query('templateType')
    .optional()
    .isIn(['campaign', 'follow-up', 'welcome', 'newsletter', 'promotional', 'transactional'])
    .withMessage('Invalid template type filter'),

  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),

  checkValidation
];

module.exports = {
  // Campaign validators
  validateCreateCampaign,
  validateUpdateCampaign,
  validateCampaignId,
  validateGetCampaigns,

  // Email template validators
  validateCreateEmailTemplate,
  validateUpdateEmailTemplate,
  validateTemplateId,
  validateGetEmailTemplates,

  // Utility
  checkValidation
};