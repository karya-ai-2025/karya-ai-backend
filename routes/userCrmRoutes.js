const express = require('express');
const { body, validationResult } = require('express-validator');
const { protect } = require('../middleware/authMiddleware');
const { getUserCrmObjects, createUserCrmObject } = require('../controllers/userCrmController');

const router = express.Router();

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: errors.array()
    });
  }
  next();
};

router.use(protect);

router
  .route('/')
  .get(getUserCrmObjects)
  .post(
    [
      body('crmObjectName')
        .optional({ values: 'falsy' })
        .isLength({ min: 2, max: 100 })
        .withMessage('CRM object name must be between 2 and 100 characters'),
      body('exportFormat')
        .isIn(['email_only', 'email_phone'])
        .withMessage('Export format must be email_only or email_phone'),
      body('source')
        .optional()
        .isIn(['export', 'manual'])
        .withMessage('Source must be export or manual'),
      body('leads')
        .isArray({ min: 1 })
        .withMessage('Leads must be a non-empty array'),
      body('searchCriteria')
        .optional()
        .isObject()
        .withMessage('Search criteria must be an object'),
      body('metadata')
        .optional()
        .isObject()
        .withMessage('Metadata must be an object'),
      handleValidationErrors
    ],
    createUserCrmObject
  );

module.exports = router;
