const express = require('express');
const router = express.Router();
const { protect, optionalAuth } = require('../middleware/authMiddleware');
const c = require('../controllers/jobController');

// Multer wrapper that returns a clean JSON error instead of throwing.
const handleResumeUpload = (req, res, next) => {
  c.resumeUpload.single('resume')(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Resume file is too large' : (err.message || 'Resume upload failed');
    return res.status(400).json({ success: false, message: msg });
  });
};

// Public: browse jobs
router.get('/', c.listJobs);                              // GET  /api/jobs

// Auth actions — defined BEFORE /:idOrSlug so they aren't captured by it
router.post('/resume', protect, handleResumeUpload, c.uploadResume); // POST /api/jobs/resume
router.get('/my/applications', protect, c.myApplications);           // GET  /api/jobs/my/applications
router.get('/applications/:id/resume', protect, c.downloadResume);   // GET  /api/jobs/applications/:id/resume
router.post('/', protect, c.createJob);                              // POST /api/jobs  (internal/admin)
router.post('/import', protect, c.importJobs);                       // POST /api/jobs/import  (admin bulk)

// Public: job detail (optional auth so we can flag "already applied")
router.get('/:idOrSlug', optionalAuth, c.getJob);         // GET  /api/jobs/:idOrSlug

// Auth: apply to a job
router.post('/:id/apply', protect, c.applyToJob);         // POST /api/jobs/:id/apply

module.exports = router;
