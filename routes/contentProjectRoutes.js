const express = require('express');
const router  = express.Router();

const { protect, restrictTo } = require('../middleware/authMiddleware');

const {
  getMyProjects,
  createProject,
  submitIntake,
  getPreview,
  approveContent,
  rejectContent,
} = require('../controllers/contentProjectController');

const {
  getAllProjects,
  getProjectDetail,
  generateContent,
  updateVersion,
  saveAdminNotes,
  assignProject,
  deliverProject,
  sendToClient,
} = require('../controllers/contentProjectAdminController');

// ── SSE generate — must be first, BEFORE router.use(protect) ─────────────────
// EventSource only supports GET and cannot send Authorization headers,
// so auth is handled inside generateContent using ?_token=<jwt>.
router.get('/admin/:id/generate', generateContent);

// ── User routes (require JWT) ─────────────────────────────────────────────────
router.get('/my',               protect, getMyProjects);
router.post('/',                protect, createProject);
router.post('/:id/intake',      protect, submitIntake);
router.get('/:id/preview',      protect, getPreview);
router.post('/:id/approve',     protect, approveContent);
router.post('/:id/reject',      protect, rejectContent);

// ── Admin routes ──────────────────────────────────────────────────────────────
const adminRouter = express.Router({ mergeParams: true });
adminRouter.use(protect, restrictTo('admin'));

adminRouter.get('/',                            getAllProjects);
adminRouter.get('/:id',                         getProjectDetail);
adminRouter.put('/:id/version/:versionNumber',  updateVersion);
adminRouter.put('/:id/admin-notes',             saveAdminNotes);
adminRouter.put('/:id/assign',                  assignProject);
adminRouter.post('/:id/deliver',                deliverProject);
adminRouter.post('/:id/send-to-client',         sendToClient);

router.use('/admin', adminRouter);

module.exports = router;
