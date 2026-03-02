// routes/marketplaceRoutes.js
// Public routes for expert marketplace

const express = require('express');
const router = express.Router();

const {
  getExperts,
  getExpertById,
  getFeaturedExpert,
  getFilterOptions,
  searchExperts
} = require('../controllers/Marketplacecontroller');

// ============================================
// PUBLIC MARKETPLACE ROUTES (no auth required)
// ============================================

// Get filter options (for dynamic filter UI)
router.get('/filters', getFilterOptions);

// Search experts (autocomplete)
router.get('/search', searchExperts);

// Get featured expert (for sidebar)
router.get('/experts/featured', getFeaturedExpert);

// Get all public experts (with filters, pagination, sorting)
router.get('/experts', getExperts);

// Get single expert profile by ID
router.get('/experts/:id', getExpertById);

module.exports = router;