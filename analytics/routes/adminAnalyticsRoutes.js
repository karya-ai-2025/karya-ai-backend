// Admin analytics dashboard routes — product analytics from MongoDB.
// Mounted at /api/admin/analytics. All routes require an admin.

const express = require('express');
const { protect, restrictTo } = require('../../middleware/authMiddleware');
const c = require('../controllers/analyticsController');

const router = express.Router();

router.use(protect, restrictTo('admin'));

router.get('/overview',  c.overview);
router.get('/pages',     c.pages);
router.get('/events',    c.events);
router.get('/apis',      c.apis);
router.get('/active-users', c.usersStats); // DAU/WAU/MAU (the legacy /analytics/users user-list stays in adminRoutes)
router.get('/funnels',   c.funnels);
router.get('/features',  c.features);
router.get('/geography', c.geography);
router.get('/realtime',  c.realtime);

module.exports = router;
