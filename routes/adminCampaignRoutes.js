// routes/adminCampaignRoutes.js
// Admin builds and starts campaigns on behalf of customers.
//
// Mounted at /api/admin/campaigns, BEFORE /api/admin, so adminRoutes never
// shadows it. Every route is admin-only.
//
// This is a parallel surface to /api/campaigns, not a replacement: the
// customer-facing routes are untouched and still owner-scoped.

const express = require('express');
const multer = require('multer');
const router = express.Router();

const { protect, restrictTo } = require('../middleware/authMiddleware');
const {
  listCustomers,
  getCustomerContext,
  getSavedList,
  searchLeadsForCustomer,
  createCampaignForCustomer,
  listAdminCampaigns,
  getAdminCampaign,
  updateAdminCampaign,
  startCampaignForCustomer,
  listCustomerTemplates,
  uploadCustomerTemplateAttachment,
  createCustomerTemplate,
  updateCustomerTemplate,
  deleteCustomerTemplate,
  createCustomerLeadList,
  deleteCustomerLeadList,
} = require('../controllers/adminCampaignController');

router.use(protect, restrictTo('admin'));

// ── Choosing the customer ────────────────────────────────────────────────────
// Declared before /:id so "users" and "leads" are never read as campaign ids.
router.get('/users', listCustomers);
router.get('/users/:userId/context', getCustomerContext);

// ── The customer's email template library ────────────────────────────────────
// Attachment uploads use the same size cap as the customer's own builder, and
// land under the CUSTOMER'S blob namespace so ownership stays meaningful.
const maxAttachmentMb = parseInt(process.env.EMAIL_ATTACHMENT_MAX_FILE_SIZE_MB, 10) || 10;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxAttachmentMb * 1024 * 1024, files: 1 },
});

const handleAttachmentUpload = (req, res, next) => {
  upload.single('attachment')(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: `File size cannot exceed ${maxAttachmentMb}MB`,
      });
    }
    return res.status(400).json({
      success: false,
      message: error.message || 'Invalid file upload',
    });
  });
};

router.post(
  '/users/:userId/template-attachments',
  handleAttachmentUpload,
  uploadCustomerTemplateAttachment
);

router.route('/users/:userId/templates')
  .get(listCustomerTemplates)
  .post(createCustomerTemplate);

router.route('/users/:userId/templates/:templateId')
  .put(updateCustomerTemplate)
  .delete(deleteCustomerTemplate);

// ── The customer's saved lead lists ──────────────────────────────────────────
router.post('/users/:userId/lead-lists', createCustomerLeadList);
router.delete('/users/:userId/lead-lists/:listId', deleteCustomerLeadList);
router.get('/users/:userId/saved-list/:listId', getSavedList);

// ── Finding leads for them ───────────────────────────────────────────────────
router.post('/leads/search', searchLeadsForCustomer);

// ── The campaign itself ──────────────────────────────────────────────────────
router.route('/')
  .get(listAdminCampaigns)          // GET  /api/admin/campaigns
  .post(createCampaignForCustomer); // POST /api/admin/campaigns

router.post('/:id/start', startCampaignForCustomer);

// Last: /:id would otherwise swallow "users" and "leads" above.
router.route('/:id')
  .get(getAdminCampaign)     // GET /api/admin/campaigns/:id  — full detail
  .put(updateAdminCampaign); // PUT /api/admin/campaigns/:id  — revise

module.exports = router;
