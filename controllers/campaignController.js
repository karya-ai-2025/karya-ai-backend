const Campaign = require('../models/Campaign');
const EmailTemplate = require('../models/EmailTemplate');
const CampaignEmail = require('../models/CampaignEmail');
const UserPlan = require('../models/UserPlan');
const UserCreditConsumption = require('../models/UserCreditConsumption');
const CreditCost = require('../models/CreditCost');
const { processCampaign, refundUnusedCredits } = require('../services/campaignProcessor');
const { validateEmailBatch, normalizeEmail } = require('../services/zeroBounceService');

const isEmailLike = (email = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());

// @desc    Get all campaigns for a user
// @route   GET /api/campaigns
// @access  Private
const getCampaigns = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const userId = req.user.id || req.user._id;

    const filters = {};
    if (status) filters.status = status;

    const campaigns = await Campaign.findByUser(userId, filters)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Campaign.countDocuments({ userId, ...filters });

    res.json({
      success: true,
      data: campaigns,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalCount: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch campaigns',
      error: error.message
    });
  }
};

// @desc    Get single campaign
// @route   GET /api/campaigns/:id
// @access  Private
const getCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      userId: req.user.id
    })
      .populate('emailTemplateId')
      .populate('settings.followUpTemplateId');

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    res.json({
      success: true,
      data: campaign
    });
  } catch (error) {
    console.error('Error fetching campaign:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch campaign',
      error: error.message
    });
  }
};

// @desc    Create new campaign
// @route   POST /api/campaigns
// @access  Private
const createCampaign = async (req, res) => {
  try {
    const {
      name,
      description,
      emailTemplateId,
      selectedLeads,
      settings,
      tags,
      scheduledAt
    } = req.body;

    const userId = req.user.id || req.user._id;

    // Validate email template exists and belongs to user
    const emailTemplate = await EmailTemplate.findOne({
      _id: emailTemplateId,
      userId: userId,
      isActive: true
    });

    if (!emailTemplate) {
      return res.status(400).json({
        success: false,
        message: 'Email template not found or not accessible'
      });
    }

    // Validate selected leads
    if (!selectedLeads || !Array.isArray(selectedLeads) || selectedLeads.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one lead must be selected'
      });
    }

    // Create campaign
    const campaign = new Campaign({
      name,
      description,
      userId: userId,
      emailTemplateId,
      selectedLeads,
      settings: {
        sendingRate: 100,
        followUpEnabled: false,
        followUpDelayHours: 72,
        timeZone: 'UTC',
        sendingHours: { start: 9, end: 17 },
        ...settings
      },
      tags: tags || [],
      scheduledAt
    });

    await campaign.save();

    // Populate the campaign before sending response
    await campaign.populate('emailTemplateId', 'templateName subject');

    res.status(201).json({
      success: true,
      data: campaign,
      message: 'Campaign created successfully'
    });
  } catch (error) {
    console.error('Error creating campaign:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create campaign',
      error: error.message
    });
  }
};

// @desc    Validate selected campaign lead emails with ZeroBounce
// @route   POST /api/campaigns/validate-emails
// @access  Private
const validateCampaignEmails = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const leads = Array.isArray(req.body.leads) ? req.body.leads : [];

    const validLeadEmails = leads
      .map((lead) => {
        const safeLead = lead || {};
        return {
          leadId: safeLead.leadId || safeLead.id || safeLead.email,
          email: normalizeEmail(safeLead.email),
          leadName: safeLead.fullName || `${safeLead.firstName || ''} ${safeLead.lastName || ''}`.trim(),
          leadCompany: safeLead.company || ''
        };
      })
      .filter((lead) => lead.email && isEmailLike(lead.email));

    const uniqueEmails = [...new Set(validLeadEmails.map((lead) => lead.email))];
    const validationCreditCost = await CreditCost.getCreditCost('VALIDATE_EMAIL');
    const maxCreditsRequired = uniqueEmails.length * validationCreditCost;

    if (maxCreditsRequired === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid email addresses were provided for validation'
      });
    }

    const userPlans = await UserPlan.findActiveByUser(userId);
    const userPlan = userPlans && userPlans.length > 0 ? userPlans[0] : null;

    if (!userPlan) {
      return res.status(402).json({
        success: false,
        message: 'No active plan found. Please subscribe to a plan to validate emails.',
        creditsRequired: maxCreditsRequired,
        creditCostPerEmail: validationCreditCost,
        remainingCredits: 0
      });
    }

    if (!userPlan.hasEnoughCredits(maxCreditsRequired)) {
      const remainingCredits = Math.max(0, userPlan.totalCredits - userPlan.creditsUsed);
      return res.status(402).json({
        success: false,
        message: `Insufficient credits. You need up to ${maxCreditsRequired} credits to validate ${uniqueEmails.length} emails, but you only have ${remainingCredits} credits remaining.`,
        creditsRequired: maxCreditsRequired,
        creditCostPerEmail: validationCreditCost,
        remainingCredits
      });
    }

    const { results, errors } = await validateEmailBatch(uniqueEmails);

    const resultByEmail = {};
    results.forEach((result) => {
      const email = normalizeEmail(result.address || result.email_address || result.email);
      if (!email) return;

      resultByEmail[email] = {
        email,
        status: result.status || 'unknown',
        subStatus: result.sub_status || '',
        isValid: result.status === 'valid',
        isValidated: true,
        details: {
          didYouMean: result.did_you_mean || '',
          freeEmail: result.free_email,
          domain: result.domain || ''
        }
      };
    });

    uniqueEmails.forEach((email) => {
      if (!resultByEmail[email]) {
        resultByEmail[email] = {
          email,
          status: 'unknown',
          subStatus: '',
          isValid: false,
          isValidated: true,
          details: {}
        };
      }
    });

    const verifiedCount = Object.values(resultByEmail).filter((result) => result.isValidated).length;
    const validCount = Object.values(resultByEmail).filter((result) => result.isValid).length;
    const notValidCount = Object.values(resultByEmail).filter((result) => result.isValidated && !result.isValid).length;
    const creditsConsumed = verifiedCount * validationCreditCost;

    if (creditsConsumed > 0) {
      userPlan.creditsUsed += creditsConsumed;
      await userPlan.save();

      await UserCreditConsumption.create({
        userId,
        userPlanId: userPlan._id,
        actionType: 'VALIDATE_EMAIL',
        creditsConsumed,
        leadId: `email_validation_${Date.now()}`,
        metadata: {
          type: 'EMAIL_VALIDATION',
          provider: 'zerobounce',
          requestedEmails: uniqueEmails.length,
          creditCostPerEmail: validationCreditCost,
          verifiedEmails: verifiedCount,
          validEmails: validCount,
          notValidEmails: notValidCount
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });
    }

    const remainingCredits = Math.max(0, userPlan.totalCredits - userPlan.creditsUsed);

    res.json({
      success: true,
      data: {
        results: resultByEmail,
        errors,
        summary: {
          totalSubmitted: uniqueEmails.length,
          verifiedCount,
          validCount,
          notValidCount,
          creditCostPerEmail: validationCreditCost,
          creditsConsumed,
          remainingCredits
        }
      },
      message: `Validated ${uniqueEmails.length} email${uniqueEmails.length !== 1 ? 's' : ''}`
    });
  } catch (error) {
    console.error('Error validating campaign emails:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate emails',
      error: error.message
    });
  }
};

// @desc    Duplicate campaign as a new draft
// @route   POST /api/campaigns/:id/duplicate
// @access  Private
const duplicateCampaign = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { name } = req.body;
    const newName = typeof name === 'string' ? name.trim() : '';

    if (!newName) {
      return res.status(400).json({
        success: false,
        message: 'New campaign name is required'
      });
    }

    if (newName.length < 2 || newName.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Campaign name must be between 2 and 100 characters'
      });
    }

    const originalCampaign = await Campaign.findOne({
      _id: req.params.id,
      userId
    });

    if (!originalCampaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    const emailTemplate = await EmailTemplate.findOne({
      _id: originalCampaign.emailTemplateId,
      userId,
      isActive: true
    });

    if (!emailTemplate) {
      return res.status(400).json({
        success: false,
        message: 'Original campaign email template is no longer available'
      });
    }

    const copiedCampaign = new Campaign({
      name: newName,
      description: originalCampaign.description || '',
      userId,
      status: 'draft',
      emailTemplateId: originalCampaign.emailTemplateId,
      selectedLeads: originalCampaign.selectedLeads.map((lead) => ({
        leadId: lead.leadId,
        email: lead.email,
        firstName: lead.firstName || '',
        lastName: lead.lastName || '',
        company: lead.company || '',
        industry: lead.industry || '',
        jobTitle: lead.jobTitle || '',
        location: lead.location || '',
        phoneNumber: lead.phoneNumber || ''
      })),
      settings: {
        sendingRate: originalCampaign.settings?.sendingRate || 100,
        followUpEnabled: originalCampaign.settings?.followUpEnabled || false,
        followUpDelayHours: originalCampaign.settings?.followUpDelayHours || 72,
        followUpTemplateId: originalCampaign.settings?.followUpTemplateId,
        timeZone: originalCampaign.settings?.timeZone || 'UTC',
        sendingHours: {
          start: originalCampaign.settings?.sendingHours?.start ?? 9,
          end: originalCampaign.settings?.sendingHours?.end ?? 17
        }
      },
      creditsPerEmail: originalCampaign.creditsPerEmail || 1,
      emailProvider: originalCampaign.emailProvider || 'mailgun',
      useExistingCreditSystem: originalCampaign.useExistingCreditSystem !== false,
      tags: originalCampaign.tags || []
    });

    await copiedCampaign.save();
    await copiedCampaign.populate('emailTemplateId', 'templateName subject');

    res.status(201).json({
      success: true,
      data: copiedCampaign,
      message: 'Campaign copied successfully'
    });
  } catch (error) {
    console.error('Error duplicating campaign:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to copy campaign',
      error: error.message
    });
  }
};

// @desc    Update campaign
// @route   PUT /api/campaigns/:id
// @access  Private
const updateCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    // Check if campaign can be updated
    if (['sending', 'completed'].includes(campaign.status)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot update campaign that is sending or completed'
      });
    }

    // Update allowed fields
    const allowedFields = [
      'name', 'description', 'emailTemplateId', 'selectedLeads',
      'settings', 'tags', 'scheduledAt'
    ];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        campaign[field] = req.body[field];
      }
    });

    await campaign.save();

    res.json({
      success: true,
      data: campaign,
      message: 'Campaign updated successfully'
    });
  } catch (error) {
    console.error('Error updating campaign:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update campaign',
      error: error.message
    });
  }
};

// @desc    Delete campaign
// @route   DELETE /api/campaigns/:id
// @access  Private
const deleteCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    // Check if campaign can be deleted
    if (campaign.status === 'sending') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete campaign that is currently sending'
      });
    }

    await Campaign.findByIdAndDelete(req.params.id);

    // Also delete associated campaign emails
    await CampaignEmail.deleteMany({ campaignId: req.params.id });

    res.json({
      success: true,
      message: 'Campaign deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting campaign:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete campaign',
      error: error.message
    });
  }
};

// @desc    Start campaign
// @route   POST /api/campaigns/:id/start
// @access  Private
const startCampaign = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const campaign = await Campaign.findOne({
      _id: req.params.id,
      userId
    }).populate('emailTemplateId');

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    if (!campaign.canBeStarted()) {
      return res.status(400).json({
        success: false,
        message: 'Campaign cannot be started in current state'
      });
    }

    // Count valid email leads
    const validLeads = campaign.selectedLeads.filter(
      (lead) => lead.email && lead.email.includes('@')
    );
    const creditsRequired = validLeads.length * (campaign.creditsPerEmail || 1);

    // Find active plan and check credits
    const userPlans = await UserPlan.findActiveByUser(userId);
    const userPlan = userPlans && userPlans.length > 0 ? userPlans[0] : null;

    if (!userPlan) {
      return res.status(402).json({
        success: false,
        message: 'No active plan found. Please subscribe to a plan to send campaigns.',
        creditsRequired,
        remainingCredits: 0
      });
    }

    if (!userPlan.hasEnoughCredits(creditsRequired)) {
      const remaining = Math.max(0, userPlan.totalCredits - userPlan.creditsUsed);
      return res.status(402).json({
        success: false,
        message: `Insufficient credits. You need ${creditsRequired} credits to send to ${validLeads.length} leads, but you only have ${remaining} credits remaining.`,
        creditsRequired,
        remainingCredits: remaining,
        leadsCount: validLeads.length
      });
    }

    // Reserve credits upfront in one write
    userPlan.creditsUsed += creditsRequired;
    await userPlan.save();

    // Create a single consumption record for the reservation
    await UserCreditConsumption.create({
      userId,
      userPlanId: userPlan._id,
      actionType: 'SEND_CAMPAIGN_EMAIL',
      creditsConsumed: creditsRequired,
      leadId: `campaign_${campaign._id}`,
      metadata: {
        campaignId: campaign._id,
        campaignName: campaign.name,
        leadsCount: validLeads.length,
        creditsPerEmail: campaign.creditsPerEmail || 1,
        type: 'reserve'
      }
    });

    // Update campaign and start
    campaign.status = 'sending';
    campaign.startedAt = new Date();
    campaign.creditsReserved = creditsRequired;
    await campaign.save();

    // Fire-and-forget: process emails in the background
    processCampaign(campaign._id).catch((err) => {
      console.error(`Background campaign processing failed for ${campaign._id}:`, err);
      Campaign.findByIdAndUpdate(campaign._id, {
        status: 'failed',
        $push: {
          errorLogs: {
            message: `Processing failed: ${err.message}`,
            errorType: 'sending',
            timestamp: new Date()
          }
        }
      }).catch(console.error);
    });

    const remainingAfterReserve = Math.max(0, userPlan.totalCredits - userPlan.creditsUsed);

    res.json({
      success: true,
      data: campaign,
      message: `Campaign started — ${creditsRequired} credits reserved for ${validLeads.length} emails`,
      creditsReserved: creditsRequired,
      remainingCredits: remainingAfterReserve
    });
  } catch (error) {
    console.error('Error starting campaign:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start campaign',
      error: error.message
    });
  }
};

// @desc    Pause campaign
// @route   POST /api/campaigns/:id/pause
// @access  Private
const pauseCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    if (!campaign.canBePaused()) {
      return res.status(400).json({
        success: false,
        message: 'Campaign cannot be paused in current state'
      });
    }

    campaign.status = 'paused';
    await campaign.save();

    // Cancel any pending/queued emails that haven't been sent yet
    const cancelResult = await CampaignEmail.updateMany(
      { campaignId: campaign._id, status: { $in: ['pending', 'queued'] } },
      { $set: { status: 'cancelled' } }
    );

    // Refund credits for unsent emails
    await refundUnusedCredits(campaign._id);

    const updatedCampaign = await Campaign.findById(campaign._id);

    res.json({
      success: true,
      data: updatedCampaign,
      message: `Campaign paused. ${cancelResult.modifiedCount} pending emails cancelled. Unused credits refunded.`
    });
  } catch (error) {
    console.error('Error pausing campaign:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to pause campaign',
      error: error.message
    });
  }
};

// @desc    Get campaign statistics
// @route   GET /api/campaigns/:id/stats
// @access  Private
const getCampaignStats = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    // Get detailed email stats
    const emailStats = await CampaignEmail.getCampaignStats(req.params.id);

    res.json({
      success: true,
      data: {
        campaign: {
          id: campaign._id,
          name: campaign.name,
          status: campaign.status,
          stats: campaign.stats,
          performance: campaign.performance
        },
        emailStats,
        summary: {
          totalLeads: campaign.stats.totalLeads,
          completionRate: campaign.completionRate,
          openRate: campaign.performance.openRate,
          clickRate: campaign.performance.clickRate,
          replyRate: campaign.performance.replyRate,
          bounceRate: campaign.performance.bounceRate
        }
      }
    });
  } catch (error) {
    console.error('Error fetching campaign stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch campaign statistics',
      error: error.message
    });
  }
};

// @desc    Get user's campaign dashboard data
// @route   GET /api/campaigns/dashboard
// @access  Private
const getDashboardData = async (req, res) => {
  try {
    // Auth middleware ensures req.user exists
    const userId = req.user.id || req.user._id;
    console.log(`Fetching campaign dashboard for authenticated user ${userId}`);

    // Try to get campaign data - handle case where models don't exist yet
    try {
      // Get overview stats
      const overviewStats = await Campaign.getUserCampaignStats(userId);

      // Get recent campaigns
      const recentCampaigns = await Campaign.findByUser(userId)
        .limit(5);

      // Get active campaigns
      const activeCampaigns = await Campaign.findByUser(userId, {
        status: { $in: ['sending', 'scheduled'] }
      });

      res.json({
        success: true,
        data: {
          overview: overviewStats,
          recentCampaigns,
          activeCampaigns,
          summary: {
            totalCampaigns: overviewStats.totalCampaigns || 0,
            activeCampaigns: activeCampaigns.length || 0,
            totalEmailsSent: overviewStats.totalEmailsSent || 0,
            totalCreditsUsed: overviewStats.totalCreditsConsumed || 0,
            averageOpenRate: overviewStats.averageOpenRate || 0,
            averageClickRate: overviewStats.averageClickRate || 0
          }
        }
      });
    } catch (modelError) {
      console.log('Campaign model not ready yet, returning empty state:', modelError.message);

      // Return empty state when models aren't ready
      res.json({
        success: true,
        data: {
          overview: {
            totalCampaigns: 0,
            totalEmailsSent: 0,
            totalCreditsConsumed: 0,
            averageOpenRate: 0,
            averageClickRate: 0
          },
          recentCampaigns: [],
          activeCampaigns: [],
          summary: {
            totalCampaigns: 0,
            activeCampaigns: 0,
            totalEmailsSent: 0,
            totalCreditsUsed: 0,
            averageOpenRate: 0,
            averageClickRate: 0
          }
        },
        message: 'Campaign system is ready! Create your first campaign to get started.'
      });
    }
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data',
      error: error.message,
      // Provide fallback empty data even on error
      data: {
        summary: {
          totalCampaigns: 0,
          activeCampaigns: 0,
          totalEmailsSent: 0,
          totalCreditsUsed: 0,
          averageOpenRate: 0,
          averageClickRate: 0
        }
      }
    });
  }
};

module.exports = {
  getCampaigns,
  getCampaign,
  createCampaign,
  validateCampaignEmails,
  duplicateCampaign,
  updateCampaign,
  deleteCampaign,
  startCampaign,
  pauseCampaign,
  getCampaignStats,
  getDashboardData
};
