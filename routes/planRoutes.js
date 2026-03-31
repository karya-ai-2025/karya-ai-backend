const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getPlans,
  getPackagesByPlan,
  getPlansWithPackages,
  getCurrentUserPlan,
  checkUserPlanAccess,
  createUserPlan
} = require('../controllers/planController');

// Public routes (no auth required)
router.get('/plans', getPlans);
router.get('/plans-with-packages', getPlansWithPackages);
router.get('/plans/:planId/packages', getPackagesByPlan);

// Protected routes (auth required) — protect applied per-route, not globally
router.get('/user/current-plan', protect, getCurrentUserPlan);
router.get('/user/check-plan-access', protect, checkUserPlanAccess);
router.post('/user/upgrade-plan', protect, createUserPlan);

module.exports = router;