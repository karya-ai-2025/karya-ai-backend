// Leads Routes - Lead Generation and Management
// Uses Global Prisma Client Singleton for Healthcare Data Access

const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { prisma } = require('../utils/prismaClient'); // Global singleton client
const router = express.Router();

// Helper function to handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: errors.array()
    });
  }
  next();
};

/**
 * GET /api/leads/companies/suggestions
 * Get company name suggestions based on search term
 */
router.get('/companies/suggestions', [
  query('search').isLength({ min: 2 }).withMessage('Search term must be at least 2 characters'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { search } = req.query;
    console.log(`Searching company suggestions for: "${search}"`);

    // Search for companies that match the search term
    const companies = await prisma.tbl_healthcare.findMany({
      where: {
        Account_Name: {
          contains: search,
          mode: 'insensitive'
        }
      },
      select: {
        Account_Name: true
      },
      distinct: ['Account_Name'],
      take: 10, // Limit to 10 suggestions
      orderBy: {
        Account_Name: 'asc'
      }
    });

    // Extract unique company names
    const suggestions = companies
      .map(company => company.Account_Name)
      .filter(name => name && name.trim()) // Remove null/empty names
      .slice(0, 8); // Further limit for better UX

    console.log(`Found ${suggestions.length} company suggestions`);

    res.json({
      success: true,
      data: suggestions,
      total: suggestions.length
    });

  } catch (error) {
    console.error('Company suggestions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch company suggestions',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/leads/company-segment
 * Get company segment for a specific company name
 */
router.get('/company-segment', [
  query('companyName').notEmpty().withMessage('Company name is required'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { companyName } = req.query;
    console.log(`Fetching segment for company: "${companyName}"`);

    // Get the segment for the specific company
    const company = await prisma.tbl_healthcare.findFirst({
      where: {
        Account_Name: {
          equals: companyName.trim()
        }
      },
      select: {
        Account_Sub_Segment: true,
        GTM_Industry: true,
        Account_Name: true
      }
    });

    if (!company) {
      return res.json({
        success: false,
        message: 'Company not found'
      });
    }

    console.log(`Found segment "${company.Account_Sub_Segment}" for company "${companyName}"`);

    res.json({
      success: true,
      data: {
        companyName: company.Account_Name,
        segment: company.Account_Sub_Segment,
        industry: company.GTM_Industry
      }
    });

  } catch (error) {
    console.error('Company segment lookup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch company segment',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/leads/locations
 * Get all available countries from Mailing_Country column
 */
router.get('/locations', async (req, res) => {
  try {
    console.log('Fetching available countries from Mailing_Country...');

    // Get distinct countries from the database
    const countries = await prisma.tbl_healthcare.findMany({
      where: {
        Mailing_Country: {
          not: null
        }
      },
      select: {
        Mailing_Country: true
      },
      distinct: ['Mailing_Country'],
      orderBy: {
        Mailing_Country: 'asc'
      }
    });

    // Extract and clean country names
    const uniqueCountries = countries
      .map(country => country.Mailing_Country)
      .filter(country => country && country.trim())
      .map(country => country.trim())
      .sort();

    console.log(`Found ${uniqueCountries.length} unique countries`);

    res.json({
      success: true,
      data: uniqueCountries,
      total: uniqueCountries.length
    });

  } catch (error) {
    console.error('Countries fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch countries',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/leads/segments
 * Get available company segments for a specific industry
 */
router.get('/segments', [
  query('industry').notEmpty().withMessage('Industry is required'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { industry } = req.query;
    console.log(`Fetching company segments for industry: "${industry}"`);

    // First, get the actual industry name from the industries table
    const industryRecord = await prisma.tbl_gtm_industry.findFirst({
      where: {
        industry_name: {
          contains: industry.replace('-', ' '),
          mode: 'insensitive'
        }
      }
    });

    let industrySearchTerm = industry;
    if (industryRecord) {
      industrySearchTerm = industryRecord.industry_name;
    }

    // Get distinct company segments for the selected industry
    const segments = await prisma.tbl_healthcare.findMany({
      where: {
        GTM_Industry: {
          contains: industrySearchTerm,
          mode: 'insensitive'
        },
        Account_Sub_Segment: {
          not: null
        }
      },
      select: {
        Account_Sub_Segment: true
      },
      distinct: ['Account_Sub_Segment'],
      orderBy: {
        Account_Sub_Segment: 'asc'
      }
    });

    // Extract unique segments
    const availableSegments = segments
      .map(segment => segment.Account_Sub_Segment)
      .filter(segment => segment && segment.trim()) // Remove null/empty segments
      .sort();

    console.log(`Found ${availableSegments.length} company segments for "${industrySearchTerm}"`);

    res.json({
      success: true,
      data: availableSegments,
      total: availableSegments.length,
      industry: industrySearchTerm
    });

  } catch (error) {
    console.error('Company segments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch company segments',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * POST /api/leads/generate
 * Generate leads based on search criteria
 */
router.post('/generate', [
  body('industry').notEmpty().withMessage('Industry is required'),
  body('company').optional().isString().withMessage('Company must be a string'),
  body('companySegment').optional().isString().withMessage('Company segment must be a string'),
  body('location').optional().isString().withMessage('Location must be a string'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { industry, company, companySegment, location } = req.body;
    console.log('Generating leads with criteria:', { industry, company, companySegment, location });

    // Build search filters
    const whereClause = {};

    // Industry filter - convert slug back to industry name
    if (industry) {
      const industryRecord = await prisma.tbl_gtm_industry.findFirst({
        where: {
          industry_name: {
            contains: industry.replace('-', ' '),
            mode: 'insensitive'
          }
        }
      });

      const industrySearchTerm = industryRecord ? industryRecord.industry_name : industry;
      whereClause.GTM_Industry = {
        contains: industrySearchTerm,
        mode: 'insensitive'
      };
    }

    // Company filter
    if (company && company.trim()) {
      whereClause.Account_Name = {
        contains: company.trim(),
        mode: 'insensitive'
      };
    }

    // Company segment filter
    if (companySegment && companySegment.trim()) {
      whereClause.Account_Sub_Segment = {
        equals: companySegment.trim()
      };
    }

    // Location filter - search in Mailing_Country only
    if (location && location.trim()) {
      whereClause.Mailing_Country = {
        contains: location.trim(),
        mode: 'insensitive'
      };
    }

    // Build base criteria for total count (without company-specific filters)
    const baseCriteria = {};
    if (industry) {
      const industryRecord = await prisma.tbl_gtm_industry.findFirst({
        where: {
          industry_name: {
            contains: industry.replace('-', ' '),
            mode: 'insensitive'
          }
        }
      });
      const industrySearchTerm = industryRecord ? industryRecord.industry_name : industry;
      baseCriteria.GTM_Industry = {
        contains: industrySearchTerm,
        mode: 'insensitive'
      };
    }
    if (companySegment && companySegment.trim()) {
      baseCriteria.Account_Sub_Segment = {
        equals: companySegment.trim()
      };
    }
    if (location && location.trim()) {
      baseCriteria.Mailing_Country = {
        contains: location.trim(),
        mode: 'insensitive'
      };
    }

    // Execute search with pagination and get both matched and available counts
    const [leads, totalMatched, totalAvailable] = await Promise.all([
      prisma.tbl_healthcare.findMany({
        where: whereClause,
        select: {
          id: true,
          First_Name: true,
          Last_Name: true,
          title: true,
          Account_Name: true,
          email: true,
          phone: true,
          mobile: true,
          GTM_Industry: true,
          GTM_Sector: true,
          Account_Sub_Segment: true,
          Mailing_Country: true,
          employees: true
        },
        take: 50, // Limit results for better performance
        orderBy: [
          { Account_Name: 'asc' },
          { Last_Name: 'asc' }
        ]
      }),
      prisma.tbl_healthcare.count({
        where: whereClause
      }),
      prisma.tbl_healthcare.count({
        where: baseCriteria
      })
    ]);

    console.log(`Found ${leads.length} leads (${totalMatched} matched out of ${totalAvailable} available for criteria)`);

    res.json({
      success: true,
      data: leads,
      pagination: {
        totalMatched: totalMatched,
        totalAvailable: totalAvailable,
        returned: leads.length,
        hasMore: totalMatched > 50
      },
      criteria: {
        industry,
        company,
        companySegment,
        location
      }
    });

  } catch (error) {
    console.error('Lead generation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate leads',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/leads/stats
 * Get lead generation statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const [
      totalContacts,
      totalCompanies,
      industriesWithData,
      segmentsWithData
    ] = await Promise.all([
      prisma.tbl_healthcare.count(),
      prisma.tbl_healthcare.count({
        distinct: ['Account_Name']
      }),
      prisma.tbl_healthcare.count({
        distinct: ['GTM_Industry'],
        where: {
          GTM_Industry: {
            not: null
          }
        }
      }),
      prisma.tbl_healthcare.count({
        distinct: ['Account_Sub_Segment'],
        where: {
          Account_Sub_Segment: {
            not: null
          }
        }
      })
    ]);

    res.json({
      success: true,
      data: {
        totalContacts,
        totalCompanies,
        industriesWithData,
        segmentsWithData
      }
    });

  } catch (error) {
    console.error('Lead stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch lead statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;