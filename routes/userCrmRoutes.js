const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { protect } = require('../middleware/authMiddleware');
const { requireCapability } = require('../middleware/orgContext');
const { projectContext } = require('../middleware/projectContext');
const {
  getUserCrmObjects,
  getUserCrmObject,
  createUserCrmObject,
  updateUserCrmObject,
  deleteUserCrmObject
} = require('../controllers/userCrmController');

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

router.use(protect, projectContext);   // which project, if any

// Saved lead lists: reading needs leads.view, keeping or changing a list needs
// leads.save. Both are part of a business's "get leads" side, so a business
// holds them without self-serve.
const viewLeads = requireCapability('leads.view');
const saveLeads = requireCapability('leads.save');
router.use((req, res, next) => (req.method === 'GET' ? viewLeads : saveLeads)(req, res, next));

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

router
  .route('/:id')
  .get(
    [
      param('id').isMongoId().withMessage('Invalid CRM object ID'),
      handleValidationErrors
    ],
    getUserCrmObject
  )
  .put(
    [
      param('id').isMongoId().withMessage('Invalid CRM object ID'),
      body('crmObjectName')
        .optional()
        .isLength({ min: 2, max: 100 })
        .withMessage('CRM object name must be between 2 and 100 characters'),
      body('exportFormat')
        .optional()
        .isIn(['email_only', 'email_phone'])
        .withMessage('Export format must be email_only or email_phone'),
      body('source')
        .optional()
        .isIn(['export', 'manual'])
        .withMessage('Source must be export or manual'),
      body('leads')
        .optional()
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
    updateUserCrmObject
  )
  .delete(
    [
      param('id').isMongoId().withMessage('Invalid CRM object ID'),
      handleValidationErrors
    ],
    deleteUserCrmObject
  );

module.exports = router;
