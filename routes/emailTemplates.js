const express = require('express');
const multer = require('multer');
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
  duplicateEmailTemplate,
  uploadEmailTemplateAttachment,
  deleteEmailTemplateAttachment
} = require('../controllers/emailTemplateController');

const maxAttachmentFileSizeMb = parseInt(process.env.EMAIL_ATTACHMENT_MAX_FILE_SIZE_MB, 10) || 10;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxAttachmentFileSizeMb * 1024 * 1024,
    files: 1
  }
});

const handleAttachmentUpload = (req, res, next) => {
  upload.single('attachment')(req, res, (error) => {
    if (!error) return next();

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: `Attachment size cannot exceed ${maxAttachmentFileSizeMb}MB`
      });
    }

    return res.status(400).json({
      success: false,
      message: error.message || 'Invalid attachment upload'
    });
  });
};

// Apply authentication middleware to all routes
router.use(protect);

// Template utility routes (before /:id to avoid conflicts)
router.get('/categories', getTemplateCategories);  // GET /api/email-templates/categories
router.get('/popular', getPopularTemplates);       // GET /api/email-templates/popular
router.post('/attachments/upload', handleAttachmentUpload, uploadEmailTemplateAttachment);
router.delete('/attachments', deleteEmailTemplateAttachment);

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
