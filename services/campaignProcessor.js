const Campaign = require('../models/Campaign');
const CampaignEmail = require('../models/CampaignEmail');
const EmailTemplate = require('../models/EmailTemplate');
const UserPlan = require('../models/UserPlan');
const UserCreditConsumption = require('../models/UserCreditConsumption');
const { sendEmail } = require('./mailgunService');
const { downloadAttachmentBuffer, uploadAttachmentBuffer } = require('./blobStorageService');
// const { fillPdf } = require('./pdfFillService'); // PDF-per-lead feature disabled for live (avoids loading pdf-lib)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stripHtml = (html = '') => html.replace(/<[^>]*>/g, '');

const normalizeAttachmentMetadata = (attachments = []) => {
  if (!Array.isArray(attachments)) return [];

  return attachments
    .filter((attachment) => attachment && attachment.blobName)
    .map((attachment) => ({
      originalName: attachment.originalName,
      fileName: attachment.fileName,
      blobName: attachment.blobName,
      contentType: attachment.contentType || 'application/octet-stream',
      size: attachment.size || 0,
      uploadedAt: attachment.uploadedAt
    }));
};

const buildMailAttachments = async (attachments = []) => {
  if (!attachments.length) return [];

  return Promise.all(attachments.map(async (attachment) => ({
    filename: attachment.originalName || attachment.fileName || 'attachment',
    contentType: attachment.contentType || 'application/octet-stream',
    size: attachment.size,
    data: await downloadAttachmentBuffer(attachment.blobName)
  })));
};

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
  const templateAttachments = normalizeAttachmentMetadata(emailTemplate.attachments);
  let cachedMailAttachments = null;

  const getMailAttachments = async () => {
    if (!cachedMailAttachments) {
      cachedMailAttachments = buildMailAttachments(templateAttachments);
    }
    return cachedMailAttachments;
  };

  // ── PDF-per-lead feature TEMPORARILY DISABLED for live ─────────────────────
  // Azure Blob for PDFs isn't configured on live yet, so building a per-recipient
  // PDF would throw. Forcing docTemplate = null makes every campaign send with only
  // its static attachments — the PDF branches below (and the pdfFillService require
  // at the top) are skipped and can't error. To re-enable: restore the block below
  // and the require, and nothing else changes.
  const docTemplate = null;
  /*
  // Optional per-recipient fillable PDF (mail-merge into a PDF). The template
  // bytes are downloaded once and cached; each lead gets its own filled copy.
  const docTemplate = emailTemplate.documentTemplate?.blobName ? emailTemplate.documentTemplate : null;
  let docTemplateBuffer = null;
  const getDocTemplateBuffer = async () => {
    if (docTemplate && !docTemplateBuffer) docTemplateBuffer = await downloadAttachmentBuffer(docTemplate.blobName);
    return docTemplateBuffer;
  };

  const buildLeadDocument = async (leadData) => {
    const buf = await getDocTemplateBuffer();
    const values = {};
    (docTemplate.fields || []).forEach((f) => {
      values[f.name] = (f.mapsTo && leadData[f.mapsTo]) || f.defaultValue || '';
    });
    const filled = await fillPdf(buf, values);
    const baseName = String(docTemplate.originalName || 'document').replace(/\.pdf$/i, '');
    const who = String(leadData.fullName || leadData.email || 'lead').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 40);
    return uploadAttachmentBuffer({
      userId: campaign.userId,
      file: { originalname: `${baseName}-${who}.pdf`, buffer: filled, mimetype: 'application/pdf', size: filled.length }
    });
  };
  */

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

    // Static template attachments + (optionally) this lead's personalized PDF.
    let perLeadAttachments = templateAttachments;
    if (docTemplate) {
      try {
        const leadPdf = await buildLeadDocument(leadData);
        perLeadAttachments = [...templateAttachments, leadPdf];
      } catch (err) {
        console.error(`PDF personalization failed for ${lead.email}:`, err.message);
        perLeadAttachments = templateAttachments; // fall back to sending without the PDF
      }
    }

    const campaignEmail = new CampaignEmail({
      campaignId: campaign._id,
      userId: campaign.userId,
      leadId: lead.leadId,
      leadEmail: lead.email,
      leadName: `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.email,
      leadCompany: lead.company || '',
      personalizedSubject: subject,
      personalizedBody: body,
      attachments: perLeadAttachments,
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

      const contentType = emailTemplate.settings?.contentType || 'html';
      const isTextOnly = contentType === 'text';
      // With a per-recipient PDF, each email has its own attachments; otherwise
      // reuse the shared (cached) static template attachments.
      const mailAttachments = docTemplate
        ? await buildMailAttachments(campaignEmail.attachments)
        : await getMailAttachments();
      const result = await sendEmail({
        to: campaignEmail.leadEmail,
        subject: campaignEmail.personalizedSubject,
        html: isTextOnly ? undefined : campaignEmail.personalizedBody,
        text: isTextOnly ? campaignEmail.personalizedBody : stripHtml(campaignEmail.personalizedBody),
        attachments: mailAttachments
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
