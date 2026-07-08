/**
 * emailCampaignService — turns an approved AI draft + recipient list into a
 * DRAFT Campaign (plus its EmailTemplate(s)) using the existing campaign models.
 *
 * It deliberately stops at status 'draft'. It never starts sending or reserves
 * credits — the user does that from the campaign UI (the "Review & Send" step).
 */

const EmailTemplate = require('../../models/EmailTemplate');
const Campaign = require('../../models/Campaign');

// Map a tbl_healthcare row → Campaign.selectedLeads shape.
const toSelectedLead = (row) => ({
  leadId: String(row.id),
  email: String(row.email || '').trim().toLowerCase(),
  firstName: row['First Name'] || '',
  lastName: row['Last Name'] || '',
  company: row['Account Name'] || '',
  industry: row['GTM Industry'] || '',
  jobTitle: row.title || '',
  location: row['Mailing Country'] || '',
  phoneNumber: row.phone || ''
});

const isEmailLike = (email = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());

// Convert AI draft merge tags ({{firstName}}) to the campaign's format ({firstName})
// and drop {{senderName}} (personalizeContent has no sender key) — see the
// merge-tag mismatch between the HITL draft endpoint and campaignProcessor.
const normalizeMergeTags = (text = '') =>
  String(text)
    .replace(/\{\{\s*senderName\s*\}\}/gi, '')
    .replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, '{$1}');

// Build the campaign from already-shaped selectedLeads (used by chat + CSV upload).
const buildDraftCampaign = async ({ userId, campaignName, draft, selectedLeads }) => {
  const leads = (selectedLeads || []).filter((lead) => isEmailLike(lead.email));
  if (leads.length === 0) {
    throw new Error('No recipients with valid emails to build a campaign.');
  }

  const primaryTemplate = await EmailTemplate.create({
    templateName: `${campaignName} — Primary`.slice(0, 100),
    userId,
    subject: draft.subject,
    emailBody: normalizeMergeTags(draft.body),
    templateType: 'campaign',
    category: 'sales'
  });

  let followUpTemplate = null;
  if (draft.followUpSubject && draft.followUpBody) {
    followUpTemplate = await EmailTemplate.create({
      templateName: `${campaignName} — Follow-up`.slice(0, 100),
      userId,
      subject: draft.followUpSubject,
      emailBody: normalizeMergeTags(draft.followUpBody),
      templateType: 'follow-up',
      category: 'follow-up'
    });
  }

  const campaign = await Campaign.create({
    name: campaignName.slice(0, 100),
    description: 'Drafted by Karya AI agent',
    userId,
    emailTemplateId: primaryTemplate._id,
    selectedLeads: leads,
    status: 'draft',
    settings: {
      sendingRate: 100,
      followUpEnabled: Boolean(followUpTemplate),
      followUpTemplateId: followUpTemplate?._id,
      followUpDelayHours: 72,
      timeZone: 'UTC',
      sendingHours: { start: 9, end: 17 }
    },
    tags: ['ai-agent']
  });

  return {
    campaignId: String(campaign._id),
    campaignName: campaign.name,
    recipientCount: leads.length,
    primaryTemplateId: String(primaryTemplate._id),
    followUpTemplateId: followUpTemplate ? String(followUpTemplate._id) : null
  };
};

const createDraftCampaign = async ({ userId, campaignName, draft, recipients }) => {
  const selectedLeads = (recipients || [])
    .map(toSelectedLead)
    .filter((lead) => isEmailLike(lead.email));

  if (selectedLeads.length === 0) {
    throw new Error('No recipients with valid emails to build a campaign.');
  }

  return buildDraftCampaign({ userId, campaignName, draft, selectedLeads });
};

module.exports = { createDraftCampaign, buildDraftCampaign };
