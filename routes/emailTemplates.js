const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getEmailTemplates,
  getEmailTemplate,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
  previewEmailTemplate,
  getTemplateCategories,
  getPopularTemplates,
  duplicateEmailTemplate
} = require('../controllers/emailTemplateController');

// Apply authentication middleware to all routes
router.use(protect);

// Template utility routes (before /:id to avoid conflicts)
router.get('/categories', getTemplateCategories);  // GET /api/email-templates/categories
router.get('/popular', getPopularTemplates);       // GET /api/email-templates/popular

// Template CRUD routes
router.route('/')
  .get(getEmailTemplates)      // GET /api/email-templates - Get all templates
  .post(createEmailTemplate);  // POST /api/email-templates - Create new template

// Individual template routes
router.route('/:id')
  .get(getEmailTemplate)       // GET /api/email-templates/:id - Get single template
  .put(updateEmailTemplate)    // PUT /api/email-templates/:id - Update template
  .delete(deleteEmailTemplate); // DELETE /api/email-templates/:id - Delete template

// Template action routes
router.post('/:id/preview', previewEmailTemplate);    // POST /api/email-templates/:id/preview - Preview template
router.post('/:id/duplicate', duplicateEmailTemplate); // POST /api/email-templates/:id/duplicate - Duplicate template

module.exports = router;