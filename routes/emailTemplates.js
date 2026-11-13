const express = require('express');
const multer = require('multer');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { requireCapability } = require('../middleware/orgContext');
const { projectContext } = require('../middleware/projectContext');

// Reading templates is open to the whole organization; writing them is part
// of building campaigns, so it needs templates.manage (a business only holds
// it with self-serve; otherwise its partner or the Karya team writes them).
const viewTemplates = requireCapability('templates.view');
const manageTemplates = requireCapability('templates.manage');
const {
  getEmailTemplates,
  getEmailTemplate,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
  previewEmailTemplate,
  getTemplateCategories,
  getPopularTemplates,
  duplicateEmailTemplate,
  uploadEmailTemplateAttachment,
  deleteEmailTemplateAttachment
  // uploadDocumentTemplate  // PDF-per-lead feature disabled for live (see route below)
} = require('../controllers/emailTemplateController');

const maxAttachmentFileSizeMb = parseInt(process.env.EMAIL_ATTACHMENT_MAX_FILE_SIZE_MB, 10) || 10;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxAttachmentFileSizeMb * 1024 * 1024,
    files: 1
  }
});

const handleUpload = (fieldName) => (req, res, next) => {
  upload.single(fieldName)(req, res, (error) => {
    if (!error) return next();

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: `File size cannot exceed ${maxAttachmentFileSizeMb}MB`
      });
    }

    return res.status(400).json({
      success: false,
      message: error.message || 'Invalid file upload'
    });
  });
};

const handleAttachmentUpload = handleUpload('attachment');
// const handleDocumentUpload = handleUpload('document'); // PDF-per-lead feature disabled for live

// Apply authentication middleware to all routes
router.use(protect, projectContext);   // which project, if any

// Template utility routes (before /:id to avoid conflicts)
router.get('/categories', viewTemplates, getTemplateCategories);  // GET /api/email-templates/categories
router.get('/popular', viewTemplates, getPopularTemplates);       // GET /api/email-templates/popular
router.post('/attachments/upload', manageTemplates, handleAttachmentUpload, uploadEmailTemplateAttachment);
router.delete('/attachments', manageTemplates, deleteEmailTemplateAttachment);
// PDF-per-lead feature disabled for live — re-enable this route + the import/handler above to restore.
// router.post('/document/upload', handleDocumentUpload, uploadDocumentTemplate); // fillable PDF → detect fields

// Template CRUD routes
router.route('/')
  .get(viewTemplates, getEmailTemplates)      // GET /api/email-templates - Get all templates
  .post(manageTemplates, createEmailTemplate);  // POST /api/email-templates - Create new template

// Individual template routes
router.route('/:id')
  .get(viewTemplates, getEmailTemplate)       // GET /api/email-templates/:id - Get single template
  .put(manageTemplates, updateEmailTemplate)    // PUT /api/email-templates/:id - Update template
  .delete(manageTemplates, deleteEmailTemplate); // DELETE /api/email-templates/:id - Delete template

// Template action routes
router.post('/:id/preview', viewTemplates, previewEmailTemplate);    // POST /api/email-templates/:id/preview - Preview template
router.post('/:id/duplicate', manageTemplates, duplicateEmailTemplate); // POST /api/email-templates/:id/duplicate - Duplicate template

module.exports = router;
