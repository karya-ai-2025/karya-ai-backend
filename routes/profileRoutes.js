// routes/profileRoutes.js
// Routes for managing Business and Expert profiles

const express = require('express');
const router = express.Router();

// Controllers
const {
  getBusinessProfile,
  updateBusinessProfile,
  updateBusinessOnboarding,
  getExpertProfile,
  updateExpertProfile,
  updateExpertOnboarding,
  addPortfolioItem,
  updatePortfolioItem,
  deletePortfolioItem,
  updateAvailability,
  toggleProfileVisibility,
  getPublicExpertProfile,
  searchExperts
} = require('../controllers/profileController');

const {
  startLinkedInImport,
  completeLinkedInImport,
  getLinkedInImport,
  deleteLinkedInImport
} = require('../controllers/linkedinImportController');

// Middleware
const { protect, optionalAuth } = require('../middleware/authMiddleware');

// ============================================
// PUBLIC ROUTES - Expert Search & View
// ============================================

// Search experts (public marketplace)
router.get('/experts/search', searchExperts);

// Get public expert profile
router.get('/experts/:id', getPublicExpertProfile);

// ============================================
// PROTECTED ROUTES - Business Profile
// ============================================

// Get my business profile
router.get('/business', protect, getBusinessProfile);

// Update business profile
router.put('/business', protect, updateBusinessProfile);

// Update business onboarding progress
router.put('/business/onboarding', protect, updateBusinessOnboarding);

// ============================================
// PROTECTED ROUTES - Expert Profile
// ============================================

// Get my expert profile
router.get('/expert', protect, getExpertProfile);

// Update expert profile
router.put('/expert', protect, updateExpertProfile);

// Update expert onboarding progress
router.put('/expert/onboarding', protect, updateExpertOnboarding);

// Import from LinkedIn (Member Data Portability API)
router.get('/expert/linkedin-import', protect, getLinkedInImport);
router.post('/expert/linkedin-import/start', protect, startLinkedInImport);
router.post('/expert/linkedin-import/complete', protect, completeLinkedInImport);
router.delete('/expert/linkedin-import', protect, deleteLinkedInImport);

// Portfolio management
router.post('/expert/portfolio', protect, addPortfolioItem);
router.put('/expert/portfolio/:itemId', protect, updatePortfolioItem);
router.delete('/expert/portfolio/:itemId', protect, deletePortfolioItem);

// Availability
router.put('/expert/availability', protect, updateAvailability);

// Visibility
router.put('/expert/visibility', protect, toggleProfileVisibility);

module.exports = router;