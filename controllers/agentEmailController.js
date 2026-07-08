// Handles the "upload CSV/Excel of recipients" branch of the agent email flow.
// Parses the file, pulls the approved draft from the conversation state, and
// builds a DRAFT campaign (never sends).

const XLSX = require('xlsx');
const Conversation = require('../models/Conversation');
const { buildDraftCampaign } = require('../services/agent/emailCampaignService');
const { hasEmailAccess, buildBuyCard } = require('../services/agent/entitlements');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const isEmailLike = (email = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());

// Best-effort column mapping — matches header names case/spacing-insensitively.
const mapCsvRow = (row, idx) => {
  const lower = {};
  Object.keys(row).forEach((k) => { lower[String(k).toLowerCase().trim()] = row[k]; });

  const get = (...needles) => {
    for (const n of needles) {
      for (const key of Object.keys(lower)) {
        if (key.includes(n)) return String(lower[key] || '').trim();
      }
    }
    return '';
  };

  const fullName = get('full name', 'name');
  return {
    leadId: `csv_${idx}`,
    email: get('email', 'e-mail').toLowerCase(),
    firstName: get('first') || (fullName.split(' ')[0] || ''),
    lastName: get('last') || (fullName.split(' ').slice(1).join(' ') || ''),
    company: get('company', 'organization', 'organisation', 'account'),
    industry: get('industry', 'sector'),
    jobTitle: get('title', 'role', 'position', 'designation'),
    location: get('country', 'location', 'city'),
    phoneNumber: get('phone', 'mobile', 'contact number')
  };
};

// POST /api/agent/email/recipients-csv  (multipart: file, body: conversationId)
const uploadEmailRecipients = asyncHandler(async (req, res, next) => {
  const userId = req.user._id || req.user.id;
  const { conversationId } = req.body;

  if (!req.file) return next(new AppError('No file was uploaded.', 400));

  // Building a campaign is the paid action → require the email project.
  if (!(await hasEmailAccess(userId))) {
    return res.status(402).json({
      success: false,
      message: 'Launching a campaign needs the AI Email Outbound Engine project.',
      buyCard: buildBuyCard('email', 'create and send email campaigns')
    });
  }

  const conversation = await Conversation.findOne({ _id: conversationId, userId });
  if (!conversation) return next(new AppError('Conversation not found.', 404));

  const draft = conversation.agentState?.emailDraft;
  if (!draft || !draft.subject) {
    return next(new AppError('No approved email draft found for this conversation. Draft and approve an email first.', 400));
  }

  const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const selectedLeads = rows.map(mapCsvRow).filter((lead) => isEmailLike(lead.email));
  if (selectedLeads.length === 0) {
    return next(new AppError('No valid email addresses found. Make sure the file has an email column.', 400));
  }

  const campaignName = conversation.agentState?.emailBrief?.name || 'Outreach';
  const result = await buildDraftCampaign({ userId, campaignName, draft, selectedLeads });

  // Exit the modal email flow in the persisted state.
  if (conversation.agentState) {
    conversation.agentState.emailBrief = null;
    conversation.agentState.emailDraft = null;
    conversation.agentState.emailCampaign = result;
    conversation.markModified('agentState');
    await conversation.save();
  }

  res.json({ success: true, data: { campaign: result } });
});

module.exports = { uploadEmailRecipients };
