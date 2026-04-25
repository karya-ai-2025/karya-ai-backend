// Leads Routes - Lead Generation and Management
// Uses Global Prisma Client Singleton for Healthcare Data Access

const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { prisma } = require('../utils/prismaClient'); // Global singleton client
const CreditCost = require('../models/CreditCost');
const UserCreditConsumption = require('../models/UserCreditConsumption');
const UserPlan = require('../models/UserPlan');
const { getUserLeads, getUserLeadsCount } = require('../controllers/userLeadsController');
const { protect } = require('../middleware/authMiddleware');
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

// Helper function to get user from request (assumes auth middleware sets req.user)
const getUserFromRequest = (req) => {
  // This should be set by your auth middleware
  // For now, we'll assume it exists or extract from headers
  return req.user || null;
};

/**
 * GET /api/leads/user-leads
 * Get leads that user has accessed/downloaded
 * @access Private
 */
router.get('/user-leads', protect, getUserLeads);

/**
 * GET /api/leads/user-leads/count
 * Get count of leads that user has accessed
 * @access Private
 */
router.get('/user-leads/count', protect, getUserLeadsCount);

/**
 * GET /api/credits/cost/:actionType
 * Get credit cost for a specific action type
 */
router.get('/credits/cost/:actionType', async (req, res) => {
  try {
    const { actionType } = req.params;

    // Validate action type
    const validActions = ['VIEW_EMAIL', 'VIEW_PHONE', 'DOWNLOAD_LEADS'];
    if (!validActions.includes(actionType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action type',
        validActions
      });
    }

    // Get credit cost from database
    const creditCost = await CreditCost.findOne({
      actionType: actionType,
      isActive: true
    });

    if (!creditCost) {
      return res.status(404).json({
        success: false,
        message: `Credit cost not found for action: ${actionType}`
      });
    }

    res.json({
      success: true,
      actionType: creditCost.actionType,
      credits: creditCost.credits,
      description: creditCost.description
    });

  } catch (error) {
    console.error('Get credit cost error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get credit cost',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/credits/costs
 * Get all credit costs
 */
router.get('/credits/costs', async (req, res) => {
  try {
    const creditCosts = await CreditCost.getAllActiveCosts();

    const costsMap = {};
    creditCosts.forEach(cost => {
      costsMap[cost.actionType] = {
        credits: cost.credits,
        description: cost.description
      };
    });

    res.json({
      success: true,
      data: costsMap,
      total: creditCosts.length
    });

  } catch (error) {
    console.error('Get all credit costs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get credit costs',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * POST /api/credits/consume
 * Consume credits for a specific action
 */
router.post('/credits/consume', [
  body('actionType').isIn(['VIEW_EMAIL', 'VIEW_PHONE', 'DOWNLOAD_LEADS']).withMessage('Valid action type is required'),
  body('leadId').optional().isString().withMessage('Lead ID must be a string'),
  body('leadEmail').optional().isEmail().withMessage('Valid email is required when provided'),
  body('leadPhone').optional().isString().withMessage('Phone must be a string'),
  body('leadName').optional().isString().withMessage('Lead name must be a string'),
  body('leadCompany').optional().isString().withMessage('Lead company must be a string'),
  body('userId').notEmpty().withMessage('User ID is required'), // Temporary - should come from auth middleware
  handleValidationErrors
], async (req, res) => {
  try {
    const {
      actionType,
      leadId,
      leadEmail,
      leadPhone,
      leadName,
      leadCompany,
      userId // Temporary - should come from req.user
    } = req.body;

    console.log(`Processing credit consumption: ${actionType} for user ${userId}`);

    // Get credit cost for this action
    const creditCost = await CreditCost.getCreditCost(actionType);

    // Find user's active plan
    const userPlan = await UserPlan.findOne({
      userId: userId,
      status: 'active',
      endDate: { $gt: new Date() }
    });

    if (!userPlan) {
      return res.status(404).json({
        success: false,
        message: 'No active plan found for user'
      });
    }

    // Check if user has enough credits
    if (!userPlan.hasEnoughCredits(creditCost)) {
      const remainingCredits = userPlan.totalCredits - userPlan.creditsUsed;
      return res.status(402).json({
        success: false,
        message: 'Insufficient credits',
        required: creditCost,
        remaining: remainingCredits
      });
    }

    // For VIEW actions, check if user has already viewed this lead's contact info
    if ((actionType === 'VIEW_EMAIL' || actionType === 'VIEW_PHONE') && leadId) {
      const existingView = await UserCreditConsumption.hasUserViewedLead(userId, leadId, actionType);
      if (existingView) {
        return res.status(409).json({
          success: false,
          message: 'Contact information already viewed for this lead',
          viewedAt: existingView.createdAt
        });
      }
    }

    // Create consumption record
    const consumption = new UserCreditConsumption({
      userId: userId,
      userPlanId: userPlan._id,
      actionType: actionType,
      creditsConsumed: creditCost,
      leadId: leadId,
      leadEmail: leadEmail,
      leadPhone: leadPhone,
      leadName: leadName,
      leadCompany: leadCompany,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent')
    });

    // Update user plan credits in a transaction-like manner
    userPlan.creditsUsed += creditCost;

    // Save both records
    await Promise.all([
      consumption.save(),
      userPlan.save()
    ]);

    const remainingCredits = userPlan.totalCredits - userPlan.creditsUsed;

    console.log(`Credits consumed: ${creditCost}, Remaining: ${remainingCredits}`);

    res.json({
      success: true,
      message: 'Credits consumed successfully',
      consumedCredits: creditCost,
      remainingCredits: remainingCredits,
      totalCredits: userPlan.totalCredits,
      transactionId: consumption._id
    });

  } catch (error) {
    console.error('Credit consumption error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to consume credits',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/credits/history
 * Get user's credit consumption history
 */
router.get('/credits/history', [
  query('userId').notEmpty().withMessage('User ID is required'), // Temporary - should come from auth middleware
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { userId } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    console.log(`Fetching credit history for user ${userId}, page ${page}`);

    // Get consumption history
    const history = await UserCreditConsumption.getUserHistory(userId, page, limit);

    // Get total count for pagination
    const totalCount = await UserCreditConsumption.countDocuments({ userId });
    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      success: true,
      data: {
        history: history,
        pagination: {
          currentPage: page,
          totalPages: totalPages,
          totalCount: totalCount,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Credit history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch credit history',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/credits/balance/:userId
 * Get user's current credit balance
 */
router.get('/credits/balance/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    console.log(`Fetching credit balance for user ${userId}`);

    // Find user's active plan
    const userPlan = await UserPlan.findOne({
      userId: userId,
      status: 'active',
      endDate: { $gt: new Date() }
    });

    if (!userPlan) {
      return res.json({
        success: true,
        hasActivePlan: false,
        remainingCredits: 0,
        totalCredits: 0,
        creditsUsed: 0
      });
    }

    const remainingCredits = userPlan.totalCredits - userPlan.creditsUsed;

    res.json({
      success: true,
      hasActivePlan: true,
      remainingCredits: remainingCredits,
      totalCredits: userPlan.totalCredits,
      creditsUsed: userPlan.creditsUsed,
      planId: userPlan.planId,
      planPackageId: userPlan.planPackageId
    });

  } catch (error) {
    console.error('Credit balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch credit balance',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * POST /api/credits/consume-enhanced
 * Enhanced credit consumption for leads download with format options
 */
router.post('/credits/consume-enhanced', [
  body('actionType').equals('DOWNLOAD_LEADS').withMessage('Action type must be DOWNLOAD_LEADS'),
  body('downloadFormat').isIn(['email_only', 'email_phone']).withMessage('Download format must be email_only or email_phone'),
  body('leads').isArray().withMessage('Leads must be an array'),
  body('totalCost').isInt({ min: 0 }).withMessage('Total cost must be a non-negative integer'),
  body('userId').notEmpty().withMessage('User ID is required'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { actionType, downloadFormat, leads, totalCost, userId } = req.body;

    console.log(`Processing enhanced credit consumption: ${leads.length} leads for user ${userId}, format: ${downloadFormat}, cost: ${totalCost}`);

    // Find user's active plan
    const userPlan = await UserPlan.findOne({
      userId: userId,
      status: 'active',
      endDate: { $gt: new Date() }
    });

    if (!userPlan) {
      return res.status(404).json({
        success: false,
        message: 'No active plan found for user'
      });
    }

    // Check if user has enough credits
    if (totalCost > 0 && !userPlan.hasEnoughCredits(totalCost)) {
      const remainingCredits = userPlan.totalCredits - userPlan.creditsUsed;
      return res.status(402).json({
        success: false,
        message: 'Insufficient credits',
        required: totalCost,
        remaining: remainingCredits
      });
    }

    // If totalCost is 0, no credits to consume
    if (totalCost === 0) {
      return res.json({
        success: true,
        message: 'Download authorized - no additional credits required',
        consumedCredits: 0,
        remainingCredits: userPlan.totalCredits - userPlan.creditsUsed,
        totalCredits: userPlan.totalCredits
      });
    }

    // Create consumption records for each lead that consumed credits
    const consumptionRecords = leads.map(lead => ({
      userId: userId,
      userPlanId: userPlan._id,
      actionType: actionType,
      creditsConsumed: lead.creditsForThisLead,
      leadId: lead.leadId,
      leadEmail: lead.leadEmail,
      leadPhone: lead.leadPhone,
      leadName: lead.leadName,
      leadCompany: lead.leadCompany,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      metadata: {
        enhancedDownload: true,
        downloadFormat: downloadFormat,
        totalLeadsInBatch: leads.length,
        creditsForThisLead: lead.creditsForThisLead
      }
    }));

    // Update user plan credits
    userPlan.creditsUsed += totalCost;

    // Save all records in parallel
    await Promise.all([
      UserCreditConsumption.insertMany(consumptionRecords),
      userPlan.save()
    ]);

    const remainingCredits = userPlan.totalCredits - userPlan.creditsUsed;

    console.log(`Enhanced credits consumed: ${totalCost}, Format: ${downloadFormat}, Remaining: ${remainingCredits}`);

    res.json({
      success: true,
      message: 'Credits consumed successfully for enhanced download',
      consumedCredits: totalCost,
      remainingCredits: remainingCredits,
      totalCredits: userPlan.totalCredits,
      leadsProcessed: leads.length,
      downloadFormat: downloadFormat
    });

  } catch (error) {
    console.error('Enhanced credit consumption error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to consume credits for enhanced download',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * POST /api/credits/consume-batch
 * Consume credits for downloading multiple leads (legacy support)
 */
router.post('/credits/consume-batch', [
  body('actionType').equals('DOWNLOAD_LEADS').withMessage('Action type must be DOWNLOAD_LEADS'),
  body('leads').isArray().withMessage('Leads must be an array'),
  body('totalCost').isInt({ min: 0 }).withMessage('Total cost must be a non-negative integer'),
  body('userId').notEmpty().withMessage('User ID is required'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { actionType, leads, totalCost, userId } = req.body;

    console.log(`Processing batch credit consumption: ${leads.length} leads for user ${userId}, cost: ${totalCost}`);

    // Find user's active plan
    const userPlan = await UserPlan.findOne({
      userId: userId,
      status: 'active',
      endDate: { $gt: new Date() }
    });

    if (!userPlan) {
      return res.status(404).json({
        success: false,
        message: 'No active plan found for user'
      });
    }

    // Check if user has enough credits
    if (totalCost > 0 && !userPlan.hasEnoughCredits(totalCost)) {
      const remainingCredits = userPlan.totalCredits - userPlan.creditsUsed;
      return res.status(402).json({
        success: false,
        message: 'Insufficient credits',
        required: totalCost,
        remaining: remainingCredits
      });
    }

    // If totalCost is 0, no credits to consume (all leads already viewed)
    if (totalCost === 0) {
      return res.json({
        success: true,
        message: 'Download authorized - no additional credits required',
        consumedCredits: 0,
        remainingCredits: userPlan.totalCredits - userPlan.creditsUsed,
        totalCredits: userPlan.totalCredits
      });
    }

    // Create consumption records for each lead
    const consumptionRecords = leads.map(lead => ({
      userId: userId,
      userPlanId: userPlan._id,
      actionType: actionType,
      creditsConsumed: 1, // 1 credit per lead for download
      leadId: lead.leadId,
      leadEmail: lead.leadEmail,
      leadName: lead.leadName,
      leadCompany: lead.leadCompany,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      metadata: {
        batchDownload: true,
        totalLeadsInBatch: leads.length
      }
    }));

    // Update user plan credits
    userPlan.creditsUsed += totalCost;

    // Save all records in parallel
    await Promise.all([
      UserCreditConsumption.insertMany(consumptionRecords),
      userPlan.save()
    ]);

    const remainingCredits = userPlan.totalCredits - userPlan.creditsUsed;

    console.log(`Batch credits consumed: ${totalCost}, Remaining: ${remainingCredits}`);

    res.json({
      success: true,
      message: 'Credits consumed successfully for batch download',
      consumedCredits: totalCost,
      remainingCredits: remainingCredits,
      totalCredits: userPlan.totalCredits,
      leadsProcessed: leads.length
    });

  } catch (error) {
    console.error('Batch credit consumption error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to consume credits for batch download',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * POST /api/credits/consume-bulk
 * Bulk credit consumption for large lead downloads
 */
router.post('/credits/consume-bulk', [
  body('actionType').equals('DOWNLOAD_LEADS').withMessage('Action type must be DOWNLOAD_LEADS'),
  body('downloadFormat').isIn(['email_only', 'email_phone']).withMessage('Download format must be email_only or email_phone'),
  body('downloadCount').isInt({ min: 1 }).withMessage('Download count must be a positive integer'),
  body('totalCost').isInt({ min: 0 }).withMessage('Total cost must be a non-negative integer'),
  body('userId').notEmpty().withMessage('User ID is required'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { actionType, downloadFormat, downloadCount, totalCost, searchCriteria, userId } = req.body;

    console.log(`Processing bulk credit consumption: ${downloadCount} leads for user ${userId}, format: ${downloadFormat}, cost: ${totalCost}`);

    // Find user's active plan
    const userPlan = await UserPlan.findOne({
      userId: userId,
      status: 'active',
      endDate: { $gt: new Date() }
    });

    if (!userPlan) {
      return res.status(404).json({
        success: false,
        message: 'No active plan found for user'
      });
    }

    // Check if user has enough credits
    if (totalCost > 0 && !userPlan.hasEnoughCredits(totalCost)) {
      const remainingCredits = userPlan.totalCredits - userPlan.creditsUsed;
      return res.status(402).json({
        success: false,
        message: 'Insufficient credits',
        required: totalCost,
        remaining: remainingCredits
      });
    }

    // If totalCost is 0, no credits to consume
    if (totalCost === 0) {
      return res.json({
        success: true,
        message: 'Download authorized - no additional credits required',
        consumedCredits: 0,
        remainingCredits: userPlan.totalCredits - userPlan.creditsUsed,
        totalCredits: userPlan.totalCredits
      });
    }

    // Create a single consumption record for bulk download
    const consumptionRecord = new UserCreditConsumption({
      userId: userId,
      userPlanId: userPlan._id,
      actionType: actionType,
      creditsConsumed: totalCost,
      leadId: 'bulk_download', // Special identifier for bulk downloads
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      metadata: {
        bulkDownload: true,
        downloadFormat: downloadFormat,
        downloadCount: downloadCount,
        searchCriteria: searchCriteria,
        totalCost: totalCost
      }
    });

    // Update user plan credits
    userPlan.creditsUsed += totalCost;

    // Save both records in parallel
    await Promise.all([
      consumptionRecord.save(),
      userPlan.save()
    ]);

    const remainingCredits = userPlan.totalCredits - userPlan.creditsUsed;

    console.log(`Bulk credits consumed: ${totalCost}, Format: ${downloadFormat}, Count: ${downloadCount}, Remaining: ${remainingCredits}`);

    res.json({
      success: true,
      message: 'Credits consumed successfully for bulk download',
      consumedCredits: totalCost,
      remainingCredits: remainingCredits,
      totalCredits: userPlan.totalCredits,
      downloadCount: downloadCount,
      downloadFormat: downloadFormat
    });

  } catch (error) {
    console.error('Bulk credit consumption error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to consume credits for bulk download',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * POST /api/leads/generate-for-download
 * Generate leads specifically for download (can return more than display limit)
 */
router.post('/generate-for-download', [
  body('industry').notEmpty().withMessage('Industry is required'),
  body('downloadCount').isInt({ min: 1 }).withMessage('Download count must be a positive integer'),
  body('downloadFormat').isIn(['email_only', 'email_phone']).withMessage('Download format must be email_only or email_phone'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { industry, company, companySegment, location, downloadCount, downloadFormat, userId } = req.body;
    console.log(`Generating ${downloadCount} leads for download: format=${downloadFormat}, user=${userId}`);

    // Build search filters (same as regular generate endpoint)
    const whereClause = {};

    // Industry filter
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

    // Location filter
    if (location && location.trim()) {
      whereClause.Mailing_Country = {
        contains: location.trim(),
        mode: 'insensitive'
      };
    }

    // Select fields based on download format
    const selectFields = {
      id: true,
      First_Name: true,
      Last_Name: true,
      title: true,
      Account_Name: true,
      email: true,
      GTM_Industry: true,
      GTM_Sector: true,
      Account_Sub_Segment: true,
      Mailing_Country: true,
      employees: true
    };

    if (downloadFormat === 'email_phone') {
      selectFields.phone = true;
      selectFields.mobile = true;
    }

    // Execute search with requested count
    const leads = await prisma.tbl_healthcare.findMany({
      where: whereClause,
      select: selectFields,
      take: downloadCount, // Use the requested download count
      orderBy: [
        { Account_Name: 'asc' },
        { Last_Name: 'asc' }
      ]
    });

    console.log(`Generated ${leads.length} leads for download (requested: ${downloadCount})`);

    res.json({
      success: true,
      data: leads,
      downloadInfo: {
        requested: downloadCount,
        returned: leads.length,
        format: downloadFormat
      }
    });

  } catch (error) {
    console.error('Lead generation for download error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate leads for download',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * POST /api/credits/initialize
 * Initialize credit costs in the database (run once)
 */
router.post('/credits/initialize', async (req, res) => {
  try {
    console.log('Initializing credit costs...');

    // Check if credit costs already exist
    const existingCount = await CreditCost.countDocuments();

    if (existingCount > 0) {
      const currentCosts = await CreditCost.find({ isActive: true }).sort({ actionType: 1 });
      return res.json({
        success: true,
        message: 'Credit costs already initialized',
        data: currentCosts,
        count: existingCount
      });
    }

    // Default credit cost configuration
    const defaultCosts = [
      {
        actionType: 'VIEW_EMAIL',
        credits: 1,
        description: 'View email address of a lead',
        isActive: true
      },
      {
        actionType: 'VIEW_PHONE',
        credits: 3,
        description: 'View phone number of a lead',
        isActive: true
      },
      {
        actionType: 'DOWNLOAD_LEADS',
        credits: 1,
        description: 'Download lead data (per lead)',
        isActive: true
      }
    ];

    // Insert default costs
    const insertedCosts = await CreditCost.insertMany(defaultCosts);

    console.log(`Successfully initialized ${insertedCosts.length} credit cost records`);

    res.json({
      success: true,
      message: 'Credit costs initialized successfully',
      data: insertedCosts,
      count: insertedCosts.length
    });

  } catch (error) {
    console.error('Credit initialization error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initialize credit costs',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

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