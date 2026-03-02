const express = require('express');
const router = express.Router();

const {
  updateProfilePhoto,
  updatePlatformUsage,
  updateCompanyDetails,
  updateBrandLogo,
  updateICPs,
  addICP,
  updateMarketingActivities,
  updateQuickWins,
  getOnboardingStatus,
  skipStep,
  saveAllOnboardingData
} = require('../controllers/onboardingController');

const { protect } = require('../middleware/authMiddleware');

// All onboarding routes are protected
router.use(protect);

// Get onboarding status
router.get('/business/status', getOnboardingStatus);

// Step-by-step onboarding
router.put('/business/profile-setup', updateProfilePhoto);
router.put('/business/platform-usage', updatePlatformUsage);
router.put('/business/company-details', updateCompanyDetails);
router.put('/business/brand-setup', updateBrandLogo);
router.put('/business/icp-definition', updateICPs);
router.post('/business/icp', addICP);
router.put('/business/marketing-activities', updateMarketingActivities);
router.put('/business/quick-wins', updateQuickWins);

// Skip a step
router.post('/business/skip/:step', skipStep);

// Batch save all data
router.put('/business/save-all', saveAllOnboardingData);

module.exports = router;
