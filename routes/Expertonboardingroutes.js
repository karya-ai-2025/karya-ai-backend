// routes/expertOnboardingRoutes.js
// Routes for expert onboarding flow

const express = require('express');
const router = express.Router();

// Controllers
const {
  updateProfileSetup,
  updateSkills,
  updateServices,
  updatePortfolio,
  getOnboardingStatus,
  skipStep,
  saveAllOnboardingData
} = require('../controllers/Expertonboardingcontroller');

// Middleware
const { protect } = require('../middleware/authMiddleware');

// All routes are protected - user must be logged in
router.use(protect);

// ============================================
// EXPERT ONBOARDING ROUTES
// ============================================

// Get current onboarding status and saved data
router.get('/expert/status', getOnboardingStatus);

// Step 1: Profile Setup (avatar, headline, bio, etc.)
router.put('/expert/profile-setup', updateProfileSetup);

// Step 2: Skills
router.put('/expert/skills', updateSkills);

// Step 3: Services & Pricing
router.put('/expert/services', updateServices);

// Step 4: Portfolio & Case Studies
router.put('/expert/portfolio', updatePortfolio);

// Skip a step
router.post('/expert/skip/:step', skipStep);

// Save all data at once (batch save)
router.put('/expert/save-all', saveAllOnboardingData);

module.exports = router;