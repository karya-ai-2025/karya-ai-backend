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
  saveAllOnboardingData,
  generateICPName,
  generateMarketingGoals,
} = require('../controllers/onboardingController');

const { protect } = require('../middleware/authMiddleware');
const { requireCapability } = require('../middleware/orgContext');

// Business onboarding writes to the company profile. In an enterprise that
// profile is shared, so only those who manage the organization may change
// it; invited members join an already-onboarded company. Individual accounts
// pass straight through.
const manageCompany = requireCapability('org.manage');

// All onboarding routes are protected
router.use(protect);

// Get onboarding status
router.get('/business/status', getOnboardingStatus);

// Step-by-step onboarding
router.put('/business/profile-setup', updateProfilePhoto); // the person's own photo, not the company's
router.put('/business/platform-usage', manageCompany, updatePlatformUsage);
router.put('/business/company-details', manageCompany, updateCompanyDetails);
router.put('/business/brand-setup', manageCompany, updateBrandLogo);
router.put('/business/icp-definition', manageCompany, updateICPs);
router.post('/business/icp', manageCompany, addICP);
router.put('/business/marketing-activities', manageCompany, updateMarketingActivities);
router.put('/business/quick-wins', manageCompany, updateQuickWins);

// Skip a step
router.post('/business/skip/:step', manageCompany, skipStep);

// Batch save all data
router.put('/business/save-all', manageCompany, saveAllOnboardingData);

// AI generation helpers
router.post('/business/generate-icp-name', generateICPName);
router.post('/business/generate-marketing-goals', generateMarketingGoals);

module.exports = router;
