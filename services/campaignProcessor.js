const Campaign = require('../models/Campaign');
const CampaignEmail = require('../models/CampaignEmail');
const EmailTemplate = require('../models/EmailTemplate');
const UserPlan = require('../models/UserPlan');
const UserCreditConsumption = require('../models/UserCreditConsumption');
const { sendEmail } = require('./mailgunService');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const refundUnusedCredits = async (campaignId) => {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign || !campaign.creditsReserved) return;

  const actualCreditsUsed = campaign.totalCreditsConsumed || 0;
  const refundAmount = campaign.creditsReserved - actualCreditsUsed;

  if (refundAmount <= 0) return;

  const userPlans = await UserPlan.findActiveByUser(campaign.userId);
  const userPlan = userPlans && userPlans.length > 0 ? userPlans[0] : null;
  if (!userPlan) return;

  userPlan.creditsUsed = Math.max(0, userPlan.creditsUsed - refundAmount);
  await userPlan.save();

  await UserCreditConsumption.create({
    userId: campaign.userId,
    userPlanId: userPlan._id,
    actionType: 'SEND_CAMPAIGN_EMAIL',
    creditsConsumed: refundAmount,
    leadId: `campaign_${campaign._id}`,
    metadata: {
      campaignId: campaign._id,
      campaignName: campaign.name,
      type: 'refund',
      reserved: campaign.creditsReserved,
      actualUsed: actualCreditsUsed,
      refunded: refundAmount
    }
  });

  campaign.creditsReserved = actualCreditsUsed;
  await campaign.save();

  console.log(`Campaign ${campaignId}: refunded ${refundAmount} credits (reserved: ${campaign.creditsReserved + refundAmount}, used: ${actualCreditsUsed})`);
};

const processCampaign = async (campaignId) => {
  const campaign = await Campaign.findById(campaignId).populate('emailTemplateId');
  if (!campaign) throw new Error('Campaign not found');

  const emailTemplate = campaign.emailTemplateId;
  if (!emailTemplate) throw new Error('Email template not found for campaign');

  const leads = campaign.selectedLeads.filter(
    (lead) => lead.email && lead.email.includes('@')
  );

  if (leads.length === 0) {
    campaign.status = 'failed';
    await campaign.addError('No valid email leads found', null, 'validation');
    await refundUnusedCredits(campaignId);
    return;
  }

  const campaignEmails = [];
  for (const lead of leads) {
    const existing = await CampaignEmail.findOne({
      campaignId: campaign._id,
      leadEmail: lead.email,
      emailType: 'primary'
    });
    if (existing) continue;

    const leadData = {
      firstName: lead.firstName || '',
      lastName: lead.lastName || '',
      fullName: `${lead.firstName || ''} ${lead.lastName || ''}`.trim(),
      company: lead.company || '',
      industry: lead.industry || '',
      jobTitle: lead.jobTitle || '',
      email: lead.email,
      phone: lead.phoneNumber || ''
    };

    const { subject, body } = emailTemplate.personalizeContent(leadData);

    const campaignEmail = new CampaignEmail({
      campaignId: campaign._id,
      userId: campaign.userId,
      leadId: lead.leadId,
      leadEmail: lead.email,
      leadName: `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.email,
      leadCompany: lead.company || '',
      personalizedSubject: subject,
      personalizedBody: body,
      emailType: 'primary',
      status: 'pending',
      creditsConsumed: campaign.creditsPerEmail || 1
    });

    await campaignEmail.save();
    campaignEmails.push(campaignEmail);
  }

  await emailTemplate.incrementUsage();

  const sendingRate = campaign.settings.sendingRate || 100;
  const delayBetweenEmails = Math.ceil(3600000 / sendingRate);

  let sentCount = 0;
  let failedCount = 0;

  for (const campaignEmail of campaignEmails) {
    const freshCampaign = await Campaign.findById(campaignId);
    if (!freshCampaign || freshCampaign.status !== 'sending') {
      console.log(`Campaign ${campaignId} is no longer sending (status: ${freshCampaign?.status}). Stopping.`);
      break;
    }

    try {
      campaignEmail.status = 'sending';
      campaignEmail.queuedAt = new Date();
      await campaignEmail.save();

      const result = await sendEmail({
        to: campaignEmail.leadEmail,
        subject: campaignEmail.personalizedSubject,
        html: campaignEmail.personalizedBody,
        text: campaignEmail.personalizedBody.replace(/<[^>]*>/g, '')
      });

      campaignEmail.status = 'sent';
      campaignEmail.sentAt = new Date();
      if (result.id) {
        campaignEmail.mailgunMessageId = result.id;
      }
      await campaignEmail.save();

      sentCount++;

      await Campaign.findByIdAndUpdate(campaignId, {
        $inc: {
          'stats.sentCount': 1,
          totalCreditsConsumed: campaignEmail.creditsConsumed
        }
      });
    } catch (error) {
      console.error(`Failed to send email to ${campaignEmail.leadEmail}:`, error.message);

      campaignEmail.status = 'failed';
      campaignEmail.errorMessage = error.message;
      campaignEmail.errorCode = error.status?.toString() || 'UNKNOWN';
      await campaignEmail.save();

      failedCount++;

      await Campaign.findByIdAndUpdate(campaignId, {
        $inc: { 'stats.failedCount': 1 }
      });

      await campaign.addError(
        `Failed to send to ${campaignEmail.leadEmail}: ${error.message}`,
        campaignEmail.leadEmail,
        'sending'
      );
    }

    if (delayBetweenEmails > 0) {
      await sleep(delayBetweenEmails);
    }
  }

  // Finalize campaign status
  const finalCampaign = await Campaign.findById(campaignId);
  if (finalCampaign && finalCampaign.status === 'sending') {
    finalCampaign.status = 'completed';
    finalCampaign.completedAt = new Date();
    await finalCampaign.save();
  }

  // Refund credits for unsent/failed emails
  await refundUnusedCredits(campaignId);

  console.log(`Campaign ${campaignId} processing finished. Sent: ${sentCount}, Failed: ${failedCount}`);
  return { sentCount, failedCount };
};

module.exports = { processCampaign, refundUnusedCredits };
