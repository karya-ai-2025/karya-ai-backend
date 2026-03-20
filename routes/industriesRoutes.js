// Simple Industries Routes - NO MVC Pattern
// Uses Global Prisma Client Singleton for Production Safety

const express = require('express');
const { prisma } = require('../utils/prismaClient'); // Global singleton client
const router = express.Router();

/**
 * GET /api/industries
 * Fetch all available industries from tbl_gtm_industry
 */
router.get('/', async (req, res) => {
  try {
    console.log('Fetching industries from tbl_gtm_industry...');

    // Get all industries from your PostgreSQL table
    const industries = await prisma.tbl_gtm_industry.findMany({
      select: {
        id: true,
        industry_name: true
      },
      orderBy: {
        industry_name: 'asc'
      }
    });

    console.log(`Found ${industries.length} industries`);

    // Format for frontend dropdown
    const formattedIndustries = industries.map(industry => ({
      value: industry.industry_name.toLowerCase().replace(/\s+/g, '-'), // Convert to slug
      label: industry.industry_name,
      id: industry.id
    }));

    res.json({
      success: true,
      data: formattedIndustries,
      total: industries.length
    });

  } catch (error) {
    console.error('Industries fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch industries',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/industries/count
 * Get total count of industries
 */
router.get('/count', async (req, res) => {
  try {
    const count = await prisma.tbl_gtm_industry.count();

    res.json({
      success: true,
      data: { count }
    });

  } catch (error) {
    console.error('Industries count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get industries count'
    });
  }
});

module.exports = router;