const Campaign = require('../models/Campaign');
const EmailTemplate = require('../models/EmailTemplate');
const CampaignEmail = require('../models/CampaignEmail');
const UserPlan = require('../models/UserPlan');
const UserCreditConsumption = require('../models/UserCreditConsumption');
const CreditCost = require('../models/CreditCost');
const UserCRM = require('../models/UserCRM');
const CampaignICP = require('../models/CampaignICP');
const { processCampaign, refundUnusedCredits, sendCampaignRound } = require('../services/campaignProcessor');

// Status buckets used for campaign results + follow-up segmentation.
const SEGMENT_STATUSES = {
  opened: ['opened', 'clicked', 'replied'],
  'not-opened': ['delivered', 'sent'],
  clicked: ['clicked', 'replied'],
  bounced: ['bounced', 'spam', 'failed'],
  pending: ['pending', 'queued', 'sending']
};
const { validateEmailBatch, getCachedValidations, validateAndCache, normalizeEmail } = require('../services/neverBounceService');
const { BYPASS_PAYWALL } = require('../config/testingFlags');
const { tenantFilter, tenantStamp } = require('../middleware/orgContext');

// Map a NeverBounce "result" to the small enum we store on saved leads.
const toVerificationStatus = (result = {}) => {
  if (result.isValid) return 'valid';
  const s = String(result.status || 'unknown').toLowerCase();
  return ['invalid', 'catchall', 'disposable', 'unknown'].includes(s) ? s : 'unknown';
};

// Write verification status back onto the user's saved leads (UserCRM), matched
// by email, so saved-list cards show ✓/✗ without re-validating. Grouped by
// status so it's a handful of updateMany calls, not one per lead.
const persistVerificationToSavedLeads = async (userId, resultByEmail) => {
  try {
    const now = new Date();
    const byStatus = {};
    Object.values(resultByEmail).forEach((r) => {
      const status = toVerificationStatus(r);
      (byStatus[status] = byStatus[status] || []).push(r.email);
    });
    await Promise.all(
      Object.entries(byStatus).map(([status, emails]) =>
        UserCRM.updateMany(
          { userId, 'leads.email': { $in: emails } },
          { $set: { 'leads.$[el].verificationStatus': status, 'leads.$[el].verifiedAt': now } },
          { arrayFilters: [{ 'el.email': { $in: emails } }] }
        )
      )
    );
  } catch (err) {
    console.error('Failed to persist verification to saved leads:', err.message);
  }
};

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

    const campaigns = await Campaign.findForTenant(tenantFilter(req), filters)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Campaign.countDocuments({ ...tenantFilter(req), ...filters });

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
      ...tenantFilter(req)
    })
      .populate('emailTemplateId')
      .populate('settings.followUpTemplateId')
      // The results page pre-selects each follow-up round's template from here.
      .populate('sequenceTemplates.templateId', 'templateName subject emailBody');

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
      sequenceTemplates,
      selectedLeads,
      settings,
      tags,
      scheduledAt
    } = req.body;

    const userId = req.user.id || req.user._id;

    // Validate email template exists and belongs to user
    const emailTemplate = await EmailTemplate.findOne({
      _id: emailTemplateId,
      ...tenantFilter(req),
      isActive: true
    });

    if (!emailTemplate) {
      return res.status(400).json({
        success: false,
        message: 'Email template not found or not accessible'
      });
    }

    // ── Sequence templates ────────────────────────────────────────────────
    // Keep only steps whose template actually belongs to this user, so a
    // crafted payload can't attach someone else's email content to a campaign.
    const SEQUENCE_KEYS = ['initial', 'follow_up', 'recall', 'final'];
    let cleanSequence = [];

    if (Array.isArray(sequenceTemplates) && sequenceTemplates.length) {
      const wanted = sequenceTemplates
        .filter((s) => s && SEQUENCE_KEYS.includes(s.key) && s.templateId)
        .map((s) => ({ key: s.key, templateId: String(s.templateId) }));

      const owned = await EmailTemplate.find({
        _id: { $in: wanted.map((w) => w.templateId) },
        ...tenantFilter(req),
        isActive: true
      }).select('_id').lean();
      const ownedIds = new Set(owned.map((t) => String(t._id)));

      cleanSequence = wanted
        .filter((w) => ownedIds.has(w.templateId))
        .map((w) => ({
          step: SEQUENCE_KEYS.indexOf(w.key) + 1,
          key: w.key,
          templateId: w.templateId
        }))
        .sort((a, b) => a.step - b.step);
    }

    // Step 1 always mirrors emailTemplateId, which the sender already uses.
    if (!cleanSequence.some((s) => s.key === 'initial')) {
      cleanSequence.unshift({ step: 1, key: 'initial', templateId: emailTemplate._id });
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
      ...tenantStamp(req),
      emailTemplateId,
      sequenceTemplates: cleanSequence,
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

// @desc    Validate selected campaign lead emails with NeverBounce
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

    if (uniqueEmails.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid email addresses were provided for validation'
      });
    }

    // Partition: emails already in the cache (free) vs ones needing NeverBounce (charged)
    const { cachedMap, toValidate } = await getCachedValidations(uniqueEmails);
    const maxCreditsRequired = toValidate.length * validationCreditCost;

    // Always read the plan (for the remaining-credits display); only ENFORCE and
    // charge when there are genuinely new emails to validate.
    const userPlans = await UserPlan.findActiveByUser(userId);
    const userPlan = userPlans && userPlans.length > 0 ? userPlans[0] : null;

    // ── PAYWALL (parked for testing — see config/testingFlags.js) ────────
    if (!BYPASS_PAYWALL && toValidate.length > 0) {
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
          message: `Insufficient credits. You need up to ${maxCreditsRequired} credits to validate ${toValidate.length} new email${toValidate.length !== 1 ? 's' : ''}, but you only have ${remainingCredits} credits remaining.`,
          creditsRequired: maxCreditsRequired,
          creditCostPerEmail: validationCreditCost,
          remainingCredits
        });
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    // Validate only the uncached emails (this also writes them to the cache).
    const fresh = toValidate.length ? await validateAndCache(toValidate) : [];
    const errors = [];

    const resultByEmail = {};

    // 1) Cached results (free — pulled from the EmailValidation cache)
    Object.values(cachedMap).forEach((c) => {
      resultByEmail[c.email] = {
        email: c.email,
        status: c.status || 'unknown',
        subStatus: '',
        isValid: c.status === 'valid',
        isValidated: true,
        cached: true,
        details: { providerStatus: c.providerStatus || '' }
      };
    });

    // 2) Freshly validated results (from NeverBounce)
    fresh.forEach((result) => {
      const email = normalizeEmail(result.address || result.email_address || result.email);
      if (!email) return;
      resultByEmail[email] = {
        email,
        status: result.status || 'unknown',
        subStatus: result.sub_status || '',
        isValid: result.status === 'valid',
        isValidated: true,
        cached: false,
        details: {
          didYouMean: result.did_you_mean || '',
          freeEmail: result.free_email,
          domain: result.domain || '',
          flags: result.flags || [],
          suggestedCorrection: result.suggested_correction || result.did_you_mean || '',
          executionTime: result.execution_time,
          providerStatus: result.providerStatus || ''
        }
      };
    });

    // 3) Anything still missing → unknown
    uniqueEmails.forEach((email) => {
      if (!resultByEmail[email]) {
        resultByEmail[email] = {
          email, status: 'unknown', subStatus: '', isValid: false, isValidated: true, cached: false, details: {}
        };
      }
    });

    // Persist the status onto the user's saved leads so the cards show ✓/✗ later.
    await persistVerificationToSavedLeads(userId, resultByEmail);

    const verifiedCount = Object.values(resultByEmail).filter((result) => result.isValidated).length;
    const validCount = Object.values(resultByEmail).filter((result) => result.isValid).length;
    const notValidCount = Object.values(resultByEmail).filter((result) => result.isValidated && !result.isValid).length;
    const cachedCount = Object.keys(cachedMap).length;
    const freshCount = fresh.length;

    // Charge ONLY for emails actually sent to NeverBounce — cached ones are free.
    const creditsConsumed = freshCount * validationCreditCost;

    if (creditsConsumed > 0 && userPlan) {
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
          provider: 'neverbounce',
          requestedEmails: uniqueEmails.length,
          creditCostPerEmail: validationCreditCost,
          verifiedEmails: freshCount,
          cachedEmails: cachedCount,
          validEmails: validCount,
          notValidEmails: notValidCount
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });
    }

    const remainingCredits = userPlan ? Math.max(0, userPlan.totalCredits - userPlan.creditsUsed) : 0;

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
          cachedCount,
          freshCount,
          creditCostPerEmail: validationCreditCost,
          creditsConsumed,
          remainingCredits
        }
      },
      message: `Validated ${uniqueEmails.length} email${uniqueEmails.length !== 1 ? 's' : ''} (${cachedCount} from cache, ${freshCount} newly checked)`
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
      ...tenantFilter(req)
    });

    if (!originalCampaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    const emailTemplate = await EmailTemplate.findOne({
      _id: originalCampaign.emailTemplateId,
      ...tenantFilter(req),
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
      ...tenantStamp(req),
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
      ...tenantFilter(req)
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
      ...tenantFilter(req)
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
      ...tenantFilter(req)
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

    // ── ICP gate ────────────────────────────────────────────────────────
    // The customer must have signed off on who we contact on their behalf.
    // An admin can override for a customer who has gone quiet, by passing
    // { overrideIcp: true } — recorded on the campaign so it is not silent.
    const icp = await CampaignICP.findOne({ campaignId: campaign._id });
    const overrideIcp = req.body && req.body.overrideIcp === true;

    if (!icp) {
      if (!(req.user.isAdmin && overrideIcp)) {
        return res.status(409).json({
          success: false,
          code: 'ICP_MISSING',
          message: 'This campaign has no ICP yet. An ICP must be created and approved before sending.'
        });
      }
    } else if (icp.status !== 'approved') {
      // The response window may have closed since the last sweep ran. Treat a
      // passed deadline as approved here too, so a campaign is never blocked by
      // a deadline that has already expired — and record the auto-approval.
      if (CampaignICP.isPastDeadline(icp)) {
        icp.status = 'approved';
        icp.approvedAt = new Date();
        icp.approvalSource = 'auto';
        icp.autoApproveAt = undefined;
        await icp.save();
      } else if (!(req.user.isAdmin && overrideIcp)) {
        const hoursLeft = icp.hoursUntilAutoApprove;
        return res.status(409).json({
          success: false,
          code: 'ICP_NOT_APPROVED',
          icpStatus: icp.status,
          hoursUntilAutoApprove: hoursLeft,
          message: icp.status === 'revision_requested'
            ? 'The customer has requested changes to this ICP. Revise it and send it back for approval before sending.'
            : `This campaign's ICP is awaiting customer approval. It will approve automatically in ${hoursLeft ?? '—'} hour(s) if they do not respond.`
        });
      }
    }

    if (overrideIcp && req.user.isAdmin) {
      campaign.addError(
        'Admin override: campaign started without an approved ICP (status: ' + (icp ? icp.status : 'none') + ')',
        null,
        'other'
      );
    }

    // Count valid email leads
    const validLeads = campaign.selectedLeads.filter(
      (lead) => lead.email && lead.email.includes('@')
    );
    const creditsRequired = validLeads.length * (campaign.creditsPerEmail || 1);

    // Find active plan and check credits
    const userPlans = await UserPlan.findActiveByUser(userId);
    const userPlan = userPlans && userPlans.length > 0 ? userPlans[0] : null;

    // ── PAYWALL (parked for testing — see config/testingFlags.js) ────────
    if (!BYPASS_PAYWALL) {
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
    }
    // ─────────────────────────────────────────────────────────────────────

    // Reserve credits upfront in one write. Still done whenever a plan exists,
    // so a funded account behaves identically to production — only the refusal
    // above is skipped. With no plan at all there is nothing to deduct.
    if (userPlan) {
      userPlan.creditsUsed += creditsRequired;
      await userPlan.save();
    }

    // Create a single consumption record for the reservation.
    // Skipped when there is no plan to charge (only reachable while the
    // paywall is parked) — the record is keyed to a plan, so without one
    // there is nothing meaningful to write.
    if (userPlan) {
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
    }

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

    const remainingAfterReserve = userPlan
      ? Math.max(0, userPlan.totalCredits - userPlan.creditsUsed)
      : 0;

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
      ...tenantFilter(req)
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
      ...tenantFilter(req)
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
        // The follow-up rounds sent after the primary blast. The UI needs these
        // to explain why more emails went out than there are contacts.
        rounds: (campaign.rounds || []).map((r) => ({
          type: r.type,
          segment: r.segment,
          sentCount: r.sentCount,
          sentAt: r.sentAt
        })),
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
      const recentCampaigns = await Campaign.findForTenant(tenantFilter(req))
        .limit(5);

      // Get active campaigns
      const activeCampaigns = await Campaign.findForTenant(tenantFilter(req), {
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

// @desc    Campaign results: segment counts + per-recipient list (who opened, etc.)
// @route   GET /api/campaigns/:id/results?segment=all|opened|not-opened|clicked|bounced&page=&limit=
// @access  Private
const getCampaignResults = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const campaign = await Campaign.findOne({ _id: req.params.id, userId });
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const campaignId = campaign._id;
    const { segment = 'all', page = 1, limit = 25 } = req.query;

    // Counts per raw status → roll up into buckets.
    const statusCounts = await CampaignEmail.aggregate([
      { $match: { campaignId } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const byStatus = {};
    statusCounts.forEach((s) => { byStatus[s._id] = s.count; });
    const sumOf = (list) => list.reduce((n, s) => n + (byStatus[s] || 0), 0);

    const segments = {
      total: Object.values(byStatus).reduce((n, c) => n + c, 0),
      delivered: sumOf(['delivered', 'opened', 'clicked', 'replied']),
      opened: sumOf(SEGMENT_STATUSES.opened),
      notOpened: sumOf(SEGMENT_STATUSES['not-opened']),
      clicked: sumOf(SEGMENT_STATUSES.clicked),
      bounced: sumOf(SEGMENT_STATUSES.bounced),
      pending: sumOf(SEGMENT_STATUSES.pending),
      replied: byStatus.replied || 0
    };

    // What the replies actually said. Counted from the classified intent so the
    // page can report outcomes, not just "someone wrote back".
    const intentCounts = await CampaignEmail.aggregate([
      { $match: { campaignId, status: 'replied' } },
      { $group: { _id: '$reply.intent', n: { $sum: 1 } } },
    ]);
    const byIntent = Object.fromEntries(intentCounts.map((r) => [r._id || 'other', r.n]));
    const outcomes = {
      meetingRequest: byIntent.meeting_request || 0,
      interested:     byIntent.interested || 0,
      question:       byIntent.question || 0,
      notInterested:  byIntent.not_interested || 0,
      unsubscribe:    byIntent.unsubscribe || 0,
      outOfOffice:    byIntent.out_of_office || 0,
      other:          byIntent.other || 0,
      // Auto-replies are not human replies — excluded so the rate stays honest.
      humanReplies:   intentCounts.reduce((n, r) => n + (r._id === 'out_of_office' ? 0 : r.n), 0),
    };

    // Recipient list (filtered by segment).
    const filter = { campaignId };
    if (segment !== 'all' && SEGMENT_STATUSES[segment]) {
      filter.status = { $in: SEGMENT_STATUSES[segment] };
    }
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));

    const [recipients, matchCount] = await Promise.all([
      CampaignEmail.find(filter)
        .select('leadEmail leadName leadCompany status emailType sentAt deliveredAt openedAt clickedAt')
        .sort({ openedAt: -1, sentAt: -1 })
        .skip((pageNum - 1) * perPage)
        .limit(perPage)
        .lean(),
      CampaignEmail.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: {
        campaign: { id: campaign._id, name: campaign.name, status: campaign.status, rounds: campaign.rounds || [] },
        segments,
        outcomes,
        recipients,
        pagination: { currentPage: pageNum, totalPages: Math.ceil(matchCount / perPage) || 1, totalCount: matchCount }
      }
    });
  } catch (error) {
    console.error('Error fetching campaign results:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch campaign results', error: error.message });
  }
};

// @desc    Send a follow-up / reminder round to a segment of THIS campaign
// @route   POST /api/campaigns/:id/follow-up   body: { segment, templateId }
// @access  Private
const sendCampaignFollowUp = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { segment, templateId } = req.body;

    // 'all' is the final-call round — everyone who was sent the campaign,
    // regardless of whether they opened it.
    if (!['opened', 'not-opened', 'clicked', 'all'].includes(segment)) {
      return res.status(400).json({ success: false, message: 'Segment must be opened, not-opened, clicked, or all' });
    }

    const campaign = await Campaign.findOne({ _id: req.params.id, userId });
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const template = await EmailTemplate.findOne({ _id: templateId, userId, isActive: true });
    if (!template) {
      return res.status(400).json({ success: false, message: 'Follow-up template not found or not accessible' });
    }

    // Recipients = primary-round emails in the chosen segment, minus anyone who
    // already got a follow-up on this campaign.
    // 'all' means every delivered/sent recipient of the primary round. The named
    // segments use their status buckets.
    const statusFilter = segment === 'all'
      ? { $in: ['sent', 'delivered', 'opened', 'clicked', 'replied'] }
      : { $in: SEGMENT_STATUSES[segment] };

    const [segmentEmails, alreadyFollowed] = await Promise.all([
      CampaignEmail.find({ campaignId: campaign._id, emailType: 'primary', status: statusFilter })
        .select('leadId leadEmail leadName leadCompany').lean(),
      CampaignEmail.find({ campaignId: campaign._id, emailType: 'follow-up', roundSegment: segment })
        .select('leadEmail').lean()
    ]);
    // Only skip people who already got THIS round. A final call should still
    // reach someone who received an earlier follow-up — otherwise the last step
    // of the sequence would silently skip most of the list.
    const followedSet = new Set(alreadyFollowed.map((r) => (r.leadEmail || '').toLowerCase()));
    const recipients = segmentEmails.filter((r) => r.leadEmail && !followedSet.has(r.leadEmail.toLowerCase()));

    if (recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: segment === 'all'
          ? 'Everyone on this campaign has already had the final call.'
          : 'No new recipients in this segment to follow up.'
      });
    }

    // Credit check (charged per email actually sent, inside the round).
    const costPerEmail = campaign.creditsPerEmail || 1;
    const creditsRequired = recipients.length * costPerEmail;
    const userPlans = await UserPlan.findActiveByUser(userId);
    const userPlan = userPlans && userPlans.length ? userPlans[0] : null;
    // ── PAYWALL (parked for testing — see config/testingFlags.js) ────────
    if (!BYPASS_PAYWALL && (!userPlan || !userPlan.hasEnoughCredits(creditsRequired))) {
      const remaining = userPlan ? Math.max(0, userPlan.totalCredits - userPlan.creditsUsed) : 0;
      return res.status(402).json({
        success: false,
        message: `Insufficient credits. You need up to ${creditsRequired} to send ${recipients.length} follow-ups, but you have ${remaining}.`,
        creditsRequired,
        remainingCredits: remaining
      });
    }

    // Fire the round in the background (like start).
    campaign.status = 'sending';
    await campaign.save();

    sendCampaignRound({ campaignId: campaign._id, recipients, template, emailType: 'follow-up', segment })
      .catch((err) => console.error(`Follow-up round failed for ${campaign._id}:`, err.message));

    res.status(202).json({
      success: true,
      message: `Follow-up queued to ${recipients.length} recipient${recipients.length !== 1 ? 's' : ''}`,
      data: { segment, recipientCount: recipients.length, templateId }
    });
  } catch (error) {
    console.error('Error sending campaign follow-up:', error);
    res.status(500).json({ success: false, message: 'Failed to send follow-up', error: error.message });
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
  getCampaignResults,
  sendCampaignFollowUp,
  getDashboardData
};
