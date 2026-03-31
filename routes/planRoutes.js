const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getPlans,
  getPackagesByPlan,
  getPlansWithPackages,
  getCurrentUserPlan,
  checkUserPlanAccess,
  createUserPlan,
  simpleUpgrade,
  getUserBillingHistory
} = require('../controllers/planController');

// Public routes (no auth required)
router.get('/plans', getPlans);
router.get('/plans-with-packages', getPlansWithPackages);
router.get('/plans/:planId/packages', getPackagesByPlan);

// Protected routes (auth required)
router.use(protect); // Apply auth middleware to all routes below

router.get('/user/current-plan', getCurrentUserPlan);
router.get('/user/check-plan-access', checkUserPlanAccess);
router.get('/user/billing-history', getUserBillingHistory);
router.post('/user/upgrade-plan', createUserPlan);
router.post('/user/simple-upgrade', simpleUpgrade);

module.exports = router;