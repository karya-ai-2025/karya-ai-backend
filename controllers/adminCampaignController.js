// controllers/adminCampaignController.js
// Admin builds and runs a campaign ON BEHALF OF a customer.
//
// The situation this exists for: a customer gets on a call, describes what
// they want, and the admin sets the whole thing up for them — rather than the
// customer handing over their password so we can log in as them.
//
// Design rules, matching the pattern icpController.js already established:
//
//   • The campaign's userId is ALWAYS the customer. It shows up in their
//     dashboard, their plan pays for it, their templates back it.
//   • The admin identity is recorded in createdByAdmin + adminActions[], so
//     every action taken for someone else has a name attached.
//   • The target user comes from an explicit targetUserId, never from a token
//     that pretends to be them.
//   • The ICP consent gate is NOT bypassed here. Admin-start still requires an
//     approved (or auto-approved) ICP — same as the customer's own Start.

const mongoose = require('mongoose');
const Campaign = require('../models/Campaign');
const CampaignICP = require('../models/CampaignICP');
const EmailTemplate = require('../models/EmailTemplate');
const User = require('../models/User');
const UserPlan = require('../models/UserPlan');
const UserCRM = require('../models/UserCRM');
const UserCreditConsumption = require('../models/UserCreditConsumption');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { processCampaign } = require('../services/campaignProcessor');
const { searchLeads } = require('../services/leadSearch');
const { BYPASS_PAYWALL } = require('../config/testingFlags');
const {
  uploadAttachmentBuffer,
  assertUserOwnsAttachmentBlob,
} = require('../services/blobStorageService');

const SEQUENCE_KEYS = ['initial', 'follow_up', 'recall', 'final'];

// Same caps as the customer's own template builder, so an admin-written
// template can never exceed what the customer could have made themselves.
const MAX_ATTACHMENTS_PER_TEMPLATE = 5;
const MAX_ATTACHMENT_TOTAL_SIZE =
  (parseInt(process.env.EMAIL_ATTACHMENT_MAX_TOTAL_SIZE_MB, 10) || 20) * 1024 * 1024;

const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.jpg', '.jpeg', '.png', '.gif', '.txt', '.csv',
  // HTML, so a designed email can be attached as a file too.
  '.html', '.htm',
]);

const fileExtension = (name = '') => {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
};

const isAllowedAttachmentType = (file) =>
  ALLOWED_ATTACHMENT_EXTENSIONS.has(fileExtension(file.originalname));

const STEP_LABEL = {
  initial: 'Initial',
  follow_up: 'Follow-up',
  recall: 'Recall',
  final: 'Final call',
};

const isEmailLike = (email = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());

/** Credits left on a plan, or null when the customer has no active plan. */
function creditSummary(plan) {
  if (!plan) {
    return { hasPlan: false, totalCredits: 0, creditsUsed: 0, remaining: 0, planName: null };
  }
  return {
    hasPlan: true,
    planName: plan.planId?.name || plan.planPackageId?.name || 'Active plan',
    totalCredits: plan.totalCredits,
    creditsUsed: plan.creditsUsed,
    remaining: Math.max(0, plan.totalCredits - plan.creditsUsed),
    endDate: plan.endDate,
  };
}

/** The customer's active plan, or null. */
async function activePlanFor(userId) {
  const plans = await UserPlan.findActiveByUser(userId);
  return plans && plans.length ? plans[0] : null;
}

/** Resolve and validate a targetUserId, rejecting anything that isn't a real customer. */
async function resolveTarget(targetUserId) {
  if (!targetUserId || !mongoose.Types.ObjectId.isValid(String(targetUserId))) {
    throw new AppError('A valid targetUserId is required', 400);
  }
  const user = await User.findById(targetUserId).select('fullName email isAdmin').lean();
  if (!user) throw new AppError('Customer not found', 404);
  return user;
}

/**
 * GET /api/admin/campaigns/users?q=
 * Find the customer to build for. Returns identity plus credit balance, so the
 * admin knows up front whether the send can actually be paid for.
 */
const listCustomers = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();

  const filter = q
    ? {
        $or: [
          { email: { $regex: q, $options: 'i' } },
          { fullName: { $regex: q, $options: 'i' } },
        ],
      }
    : {};

  const users = await User.find(filter)
    .select('fullName email createdAt isAdmin')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  // One query for every plan rather than one per user.
  const plans = await UserPlan.find({
    userId: { $in: users.map((u) => u._id) },
    status: 'active',
    endDate: { $gt: new Date() },
  })
    .populate(['planId', 'planPackageId'])
    .lean();

  const planByUser = new Map(plans.map((p) => [String(p.userId), p]));

  res.json({
    success: true,
    count: users.length,
    data: users.map((u) => ({
      _id: u._id,
      fullName: u.fullName,
      email: u.email,
      isAdmin: !!u.isAdmin,
      credits: creditSummary(planByUser.get(String(u._id))),
    })),
  });
});

/**
 * GET /api/admin/campaigns/users/:userId/context
 * Everything the admin needs before building: credits, saved lead lists, and
 * the templates the customer already has.
 */
const getCustomerContext = asyncHandler(async (req, res) => {
  const user = await resolveTarget(req.params.userId);

  const [plan, savedLists, templates, campaignCount] = await Promise.all([
    activePlanFor(user._id),
    UserCRM.find({ userId: user._id })
      .select('crmObjectName totalLeads createdAt leads.email')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    EmailTemplate.find({ userId: user._id, isActive: true })
      .select('templateName subject')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    Campaign.countDocuments({ userId: user._id }),
  ]);

  res.json({
    success: true,
    data: {
      user: { _id: user._id, fullName: user.fullName, email: user.email },
      credits: creditSummary(plan),
      campaignCount,
      savedLists: savedLists.map((l) => ({
        _id: l._id,
        name: l.crmObjectName,
        totalLeads: l.totalLeads,
        emailCount: (l.leads || []).filter((x) => isEmailLike(x.email)).length,
        createdAt: l.createdAt,
      })),
      templates,
    },
  });
});

/**
 * GET /api/admin/campaigns/users/:userId/saved-list/:listId
 * Expand one saved list into campaign-ready leads.
 */
const getSavedList = asyncHandler(async (req, res, next) => {
  const user = await resolveTarget(req.params.userId);

  const list = await UserCRM.findOne({
    _id: req.params.listId,
    userId: user._id, // scoped, so one customer's list can't be read via another's id
  }).lean();

  if (!list) return next(new AppError('Saved list not found for this customer', 404));

  const leads = (list.leads || [])
    .filter((l) => isEmailLike(l.email))
    .map((l, i) => ({
      leadId: l.leadId || `crm_${list._id}_${i}`,
      email: String(l.email).trim().toLowerCase(),
      firstName: l.firstName || '',
      lastName: l.lastName || '',
      company: l.company || '',
      jobTitle: l.title || '',
      industry: l.industry || '',
      location: l.country || '',
      phoneNumber: l.mobile || l.phone || '',
      verificationStatus: l.verificationStatus || '',
    }));

  res.json({
    success: true,
    data: { name: list.crmObjectName, totalLeads: list.totalLeads, leads },
  });
});

// ── Email templates, managed for a customer ─────────────────────────────────
// Same idea as the campaign itself: the template belongs to the CUSTOMER and
// appears in their own template library. createdByAdmin records who wrote it.

/**
 * GET /api/admin/campaigns/users/:userId/templates
 * The customer's full template library, bodies included, so the admin can
 * preview one before attaching it to a campaign step.
 */
const listCustomerTemplates = asyncHandler(async (req, res) => {
  const user = await resolveTarget(req.params.userId);

  const templates = await EmailTemplate.find({ userId: user._id, isActive: true })
    .select('templateName description subject emailBody templateType category tags createdByAdmin createdAt usageStats attachments settings')
    .populate('createdByAdmin', 'fullName email')
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  res.json({ success: true, count: templates.length, data: templates });
});

/**
 * POST /api/admin/campaigns/users/:userId/template-attachments
 * Upload a file (PDF, DOCX, image, …) for one of the customer's templates.
 *
 * Uploaded under the CUSTOMER'S blob prefix, not the admin's, because
 * attachments are namespaced by owner and the template belongs to them. That
 * keeps the existing ownership assertion meaningful rather than working around
 * it — the admin never ends up owning a file attached to someone else's mail.
 */
const uploadCustomerTemplateAttachment = asyncHandler(async (req, res, next) => {
  const user = await resolveTarget(req.params.userId);
  if (!req.file) return next(new AppError('No file was uploaded', 400));

  if (!isAllowedAttachmentType(req.file)) {
    return next(new AppError(
      'Unsupported file type. Allowed: PDF, Word, Excel, PowerPoint, images, TXT, CSV, HTML.',
      400
    ));
  }

  const attachment = await uploadAttachmentBuffer({ userId: user._id, file: req.file });
  res.status(201).json({ success: true, data: attachment });
});

/**
 * Validate attachments against the CUSTOMER'S blobs and normalise them.
 * Mirrors emailTemplateController's rules — same caps, same ownership check.
 */
function normaliseAttachments(attachments, userId) {
  if (!Array.isArray(attachments)) return [];

  if (attachments.length > MAX_ATTACHMENTS_PER_TEMPLATE) {
    throw new AppError(`A template can include up to ${MAX_ATTACHMENTS_PER_TEMPLATE} attachments`, 400);
  }

  const totalSize = attachments.reduce((sum, a) => sum + (Number(a?.size) || 0), 0);
  if (totalSize > MAX_ATTACHMENT_TOTAL_SIZE) {
    throw new AppError(
      `Total attachment size cannot exceed ${Math.round(MAX_ATTACHMENT_TOTAL_SIZE / (1024 * 1024))}MB`,
      400
    );
  }

  return attachments
    .filter((a) => a && a.blobName)
    .map((a) => {
      // Throws 403 if the blob isn't in this customer's namespace.
      assertUserOwnsAttachmentBlob(userId, a.blobName);
      return {
        originalName: String(a.originalName || a.fileName || 'attachment').slice(0, 255),
        fileName: String(a.fileName || a.originalName || 'attachment').slice(0, 255),
        blobName: a.blobName,
        contentType: String(a.contentType || 'application/octet-stream').slice(0, 150),
        size: Number(a.size) || 0,
        uploadedAt: a.uploadedAt ? new Date(a.uploadedAt) : new Date(),
      };
    });
}

/**
 * POST /api/admin/campaigns/users/:userId/templates
 * Write a template into the customer's library.
 * @body { templateName, subject, emailBody, description, templateType,
 *         category, tags, attachments, contentType }
 */
const createCustomerTemplate = asyncHandler(async (req, res, next) => {
  const user = await resolveTarget(req.params.userId);
  const {
    templateName, subject, emailBody, description = '',
    templateType = 'campaign', category = 'sales', tags = [],
    attachments = [], contentType = 'html',
  } = req.body;

  if (!String(templateName || '').trim() || !String(subject || '').trim() || !String(emailBody || '').trim()) {
    return next(new AppError('Template name, subject and body are all required', 400));
  }

  const template = await EmailTemplate.create({
    templateName: String(templateName).trim(),
    description: String(description).trim(),
    subject: String(subject).trim(),
    emailBody: String(emailBody).trim(),
    userId: user._id, // the customer owns it
    templateType,
    category,
    tags: Array.isArray(tags) ? tags : [],
    attachments: normaliseAttachments(attachments, user._id),
    createdByAdmin: req.user._id,
    settings: {
      contentType: contentType === 'text' ? 'text' : 'html',
      trackOpens: true,
      trackClicks: true,
      enableUnsubscribe: true,
    },
  });

  res.status(201).json({
    success: true,
    data: template,
    message: `Template saved to ${user.email}'s library.`,
  });
});

/**
 * PUT /api/admin/campaigns/users/:userId/templates/:templateId
 * Edit a template in the customer's library.
 */
const updateCustomerTemplate = asyncHandler(async (req, res, next) => {
  const user = await resolveTarget(req.params.userId);

  const template = await EmailTemplate.findOne({
    _id: req.params.templateId,
    userId: user._id, // scoped, so another customer's template can't be edited via their id
  });
  if (!template) return next(new AppError('Template not found in this customer\'s library', 404));

  ['templateName', 'subject', 'emailBody', 'description', 'templateType', 'category'].forEach((f) => {
    if (req.body[f] !== undefined) template[f] = String(req.body[f]).trim();
  });
  if (Array.isArray(req.body.tags)) template.tags = req.body.tags;
  if (Array.isArray(req.body.attachments)) {
    template.attachments = normaliseAttachments(req.body.attachments, user._id);
  }
  if (req.body.contentType !== undefined) {
    template.settings.contentType = req.body.contentType === 'text' ? 'text' : 'html';
  }

  await template.save();
  res.json({ success: true, data: template, message: 'Template updated.' });
});

/**
 * DELETE /api/admin/campaigns/users/:userId/templates/:templateId
 * Deactivate rather than destroy — a campaign may still reference it, and the
 * customer's sent history should stay readable.
 */
const deleteCustomerTemplate = asyncHandler(async (req, res, next) => {
  const user = await resolveTarget(req.params.userId);

  const template = await EmailTemplate.findOneAndUpdate(
    { _id: req.params.templateId, userId: user._id },
    { isActive: false },
    { new: true }
  );
  if (!template) return next(new AppError('Template not found in this customer\'s library', 404));

  res.json({ success: true, message: 'Template removed from the library.' });
});

// ── Lead lists, saved into the customer's CRM ───────────────────────────────

/**
 * POST /api/admin/campaigns/users/:userId/lead-lists
 * Save a set of leads as a reusable list in the customer's account — the same
 * saved lists they see, and the same ones the campaign wizard can pull from.
 * @body { name, leads: [...], searchCriteria, exportFormat }
 */
const createCustomerLeadList = asyncHandler(async (req, res, next) => {
  const user = await resolveTarget(req.params.userId);
  const { name, leads, searchCriteria = {}, exportFormat = 'email_only' } = req.body;

  if (!Array.isArray(leads) || leads.length === 0) {
    return next(new AppError('At least one lead is required to save a list', 400));
  }

  // Deduplicated on email, so a list built from several searches doesn't
  // double-bill the customer when it is used in a campaign.
  const seen = new Set();
  const clean = [];
  leads.forEach((l) => {
    const email = String(l?.email || '').trim().toLowerCase();
    if (!isEmailLike(email) || seen.has(email)) return;
    seen.add(email);
    const firstName = l.firstName || l.First_Name || '';
    const lastName = l.lastName || l.Last_Name || '';
    clean.push({
      leadId: String(l.leadId || l.id || ''),
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`.trim(),
      title: l.jobTitle || l.title || '',
      company: l.company || l.Account_Name || '',
      email,
      phone: l.phone || '',
      mobile: l.mobile || l.phoneNumber || '',
      industry: l.industry || l.GTM_Industry || '',
      sector: l.sector || '',
      segment: l.segment || '',
      country: l.location || l.country || '',
      employees: l.employees ?? null,
      verificationStatus: l.verificationStatus || '',
      rawData: l,
    });
  });

  if (!clean.length) {
    return next(new AppError('None of the supplied leads had a valid email address', 400));
  }

  const list = await UserCRM.create({
    userId: user._id, // the customer owns it
    crmObjectName: String(name || '').trim() || `Admin list — ${new Date().toISOString().slice(0, 10)}`,
    source: 'manual',
    exportFormat,
    totalLeads: clean.length,
    searchCriteria: {
      industry: searchCriteria.industry || '',
      company: searchCriteria.company || '',
      companySegment: searchCriteria.companySegment || '',
      location: searchCriteria.location || '',
    },
    leadIds: clean.map((l) => l.leadId).filter(Boolean),
    leads: clean,
    metadata: {
      requestedCount: leads.length,
      matchedCount: clean.length,
      creditsConsumed: 0,
      exportedAt: new Date(),
      autoGeneratedName: !String(name || '').trim(),
      // Recorded so the customer can see this list did not come from their own
      // search. Identity only — never a token.
      exportedBy: `admin:${req.user.email}`,
    },
  });

  res.status(201).json({
    success: true,
    data: {
      _id: list._id,
      name: list.crmObjectName,
      totalLeads: list.totalLeads,
      createdAt: list.createdAt,
    },
    message: `Saved ${clean.length} leads to ${user.email}'s account.`,
  });
});

/**
 * DELETE /api/admin/campaigns/users/:userId/lead-lists/:listId
 */
const deleteCustomerLeadList = asyncHandler(async (req, res, next) => {
  const user = await resolveTarget(req.params.userId);

  const list = await UserCRM.findOneAndDelete({
    _id: req.params.listId,
    userId: user._id,
  });
  if (!list) return next(new AppError('Saved list not found for this customer', 404));

  res.json({ success: true, message: `Deleted "${list.crmObjectName}".` });
});

/**
 * POST /api/admin/campaigns/leads/search
 * Search the lead database for a customer. Free — credits are charged at send
 * time, per email, against the customer's plan.
 * @body { targetUserId, industry, company, location, segment, seniority, cursor, limit }
 */
const searchLeadsForCustomer = asyncHandler(async (req, res, next) => {
  const { targetUserId, industry } = req.body;
  const user = await resolveTarget(targetUserId);

  if (!industry || !String(industry).trim()) {
    return next(new AppError('Industry is required to search leads', 400));
  }

  const result = await searchLeads({ ...req.body, userId: user._id });
  res.json({ success: true, data: result });
});

/**
 * Resolve the four sequence steps into templates owned by the CUSTOMER.
 *
 * Each step arrives one of two ways, mirroring what the customer's own wizard
 * can do:
 *
 *   { key, templateId }      → reuse a template they already have
 *   { key, subject, body }   → write a new one, created under their userId
 *
 * createCampaign refuses templates it cannot prove the user owns — correctly.
 * So a reused templateId is re-checked against their account here rather than
 * trusted, and a written one is created under their userId rather than the
 * admin's. Either way the customer ends up owning every template, and the
 * ownership rule is never weakened.
 *
 * Returns { key, template, reused } so the caller knows which templates it
 * created (and may need to roll back) versus which already existed.
 */
async function resolveSequenceTemplates({ sequence, user, campaignName, adminId }) {
  const byKey = new Map(
    (Array.isArray(sequence) ? sequence : [])
      .filter((s) => s && SEQUENCE_KEYS.includes(s.key))
      .map((s) => [s.key, s])
  );

  const hasContent = (s) =>
    !!s && (String(s.templateId || '').trim() ||
      (String(s.subject || '').trim() && String(s.body || '').trim()));

  if (!hasContent(byKey.get('initial'))) {
    throw new AppError(
      'The first email is required — either pick one of their templates or write a subject and body',
      400
    );
  }

  // Every referenced template is verified to belong to the customer, in one
  // query rather than one per step.
  const referencedIds = [...byKey.values()]
    .map((s) => String(s.templateId || '').trim())
    .filter((id) => id && mongoose.Types.ObjectId.isValid(id));

  const ownedTemplates = referencedIds.length
    ? await EmailTemplate.find({
        _id: { $in: referencedIds },
        userId: user._id,
        isActive: true,
      })
    : [];
  const ownedById = new Map(ownedTemplates.map((t) => [String(t._id), t]));

  const created = [];
  for (const key of SEQUENCE_KEYS) {
    const step = byKey.get(key);
    if (!step) continue;

    // ── Reuse one of the customer's existing templates ──────────────────
    const wantedId = String(step.templateId || '').trim();
    if (wantedId) {
      const existing = ownedById.get(wantedId);
      if (!existing) {
        throw new AppError(
          `The template chosen for the "${STEP_LABEL[key]}" email does not belong to ${user.email}`,
          400
        );
      }
      created.push({ key, template: existing, reused: true });
      continue;
    }

    // ── Or write a new one for them ─────────────────────────────────────
    const subject = String(step.subject || '').trim();
    const body = String(step.body || '').trim();
    if (!subject || !body) continue; // a partially written later step is simply skipped

    const template = await EmailTemplate.create({
      templateName: `${campaignName} — ${STEP_LABEL[key]}`,
      description: `Written by an admin for ${user.email} while setting up "${campaignName}".`,
      userId: user._id, // the customer owns it
      subject,
      emailBody: body,
      templateType: key === 'initial' ? 'campaign' : 'follow-up',
      category: 'sales',
      tags: ['admin-created'],
      // Validated against the customer's own blob namespace, same as a
      // template written on the standalone library page.
      attachments: normaliseAttachments(step.attachments, user._id),
      createdByAdmin: adminId,
    });

    created.push({ key, template, reused: false });
  }

  return created;
}

/**
 * POST /api/admin/campaigns
 * Build a complete campaign for a customer: their templates, their leads,
 * their ownership.
 *
 * @body {
 *   targetUserId, name, description,
 *   sequence: [{ key: 'initial'|'follow_up'|'recall'|'final', subject, body }],
 *   selectedLeads: [{ leadId, email, firstName, ... }],
 *   settings, tags, scheduledAt, note
 * }
 */
const createCampaignForCustomer = asyncHandler(async (req, res, next) => {
  const {
    targetUserId,
    name,
    description = '',
    sequence,
    selectedLeads,
    settings = {},
    tags = [],
    scheduledAt,
    note = '',
  } = req.body;

  const user = await resolveTarget(targetUserId);

  if (!name || !String(name).trim()) {
    return next(new AppError('Campaign name is required', 400));
  }

  // ── Leads ───────────────────────────────────────────────────────────────
  // Deduplicated by email: the same person reached through a saved list and a
  // fresh search would otherwise be mailed twice and billed twice.
  if (!Array.isArray(selectedLeads) || selectedLeads.length === 0) {
    return next(new AppError('At least one lead must be selected', 400));
  }

  const seen = new Set();
  const cleanLeads = [];
  selectedLeads.forEach((lead, i) => {
    const email = String(lead?.email || '').trim().toLowerCase();
    if (!isEmailLike(email) || seen.has(email)) return;
    seen.add(email);
    cleanLeads.push({
      leadId: String(lead.leadId || `manual_${i + 1}`),
      email,
      firstName: lead.firstName || '',
      lastName: lead.lastName || '',
      company: lead.company || '',
      industry: lead.industry || '',
      jobTitle: lead.jobTitle || '',
      location: lead.location || '',
      phoneNumber: lead.phoneNumber || '',
    });
  });

  if (!cleanLeads.length) {
    return next(new AppError('None of the supplied leads had a valid email address', 400));
  }

  // ── Templates ───────────────────────────────────────────────────────────
  const campaignName = String(name).trim();
  const steps = await resolveSequenceTemplates({
    sequence,
    user,
    campaignName,
    adminId: req.user._id,
  });

  const initialTemplate = steps.find((t) => t.key === 'initial').template;

  const sequenceTemplates = steps.map((t) => ({
    step: SEQUENCE_KEYS.indexOf(t.key) + 1,
    key: t.key,
    templateId: t.template._id,
  }));

  // Only templates this request created are ours to roll back. A reused one is
  // the customer's existing property and must survive a failed campaign save.
  const rollbackIds = steps.filter((t) => !t.reused).map((t) => t.template._id);

  // ── Campaign ────────────────────────────────────────────────────────────
  let campaign;
  try {
    campaign = await Campaign.create({
      name: campaignName,
      description: String(description).trim(),
      userId: user._id, // the customer's, always
      emailTemplateId: initialTemplate._id,
      sequenceTemplates,
      selectedLeads: cleanLeads,
      settings: {
        sendingRate: 100,
        followUpEnabled: false,
        followUpDelayHours: 72,
        timeZone: 'UTC',
        sendingHours: { start: 9, end: 17 },
        ...settings,
      },
      tags: Array.isArray(tags) ? tags : [],
      scheduledAt,
      createdByAdmin: req.user._id,
      adminActions: [{
        action: 'created',
        adminId: req.user._id,
        adminEmail: req.user.email,
        note: String(note).trim() || `Created for ${user.email} after a call`,
        at: new Date(),
      }],
    });
  } catch (err) {
    // Don't strand orphan templates in the customer's account if the campaign
    // itself fails validation. Reused templates are excluded — deleting one
    // would destroy something the customer already owned.
    await EmailTemplate.deleteMany({ _id: { $in: rollbackIds } }).catch(() => {});
    throw err;
  }

  const plan = await activePlanFor(user._id);
  const credits = creditSummary(plan);
  const creditsRequired = cleanLeads.length * (campaign.creditsPerEmail || 1);

  await campaign.populate('emailTemplateId', 'templateName subject');

  res.status(201).json({
    success: true,
    data: campaign,
    // Surfaced now rather than at Start, so a shortfall is visible while there
    // is still time to top the customer up.
    billing: {
      creditsRequired,
      ...credits,
      sufficient: credits.hasPlan && credits.remaining >= creditsRequired,
    },
    message: `Campaign created for ${user.email}. Next: create the ICP and send it for approval.`,
  });
});

/**
 * GET /api/admin/campaigns
 * Campaigns admins built for customers, with ICP and billing status.
 * @query targetUserId  restrict to one customer
 * @query mine          'true' → only campaigns this admin created
 */
const listAdminCampaigns = asyncHandler(async (req, res) => {
  const filter = { createdByAdmin: { $exists: true, $ne: null } };

  if (req.query.targetUserId && mongoose.Types.ObjectId.isValid(String(req.query.targetUserId))) {
    filter.userId = req.query.targetUserId;
  }
  if (req.query.mine === 'true') {
    filter.createdByAdmin = req.user._id;
  }

  const campaigns = await Campaign.find(filter)
    .select('name status userId createdByAdmin createdAt stats selectedLeads adminActions scheduledAt')
    .populate('userId', 'fullName email')
    .populate('createdByAdmin', 'fullName email')
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  const icps = await CampaignICP.find({
    campaignId: { $in: campaigns.map((c) => c._id) },
  })
    .select('campaignId status autoApproveAt')
    .lean();

  const icpByCampaign = new Map(icps.map((i) => [String(i.campaignId), i]));

  res.json({
    success: true,
    count: campaigns.length,
    data: campaigns.map((c) => ({
      ...c,
      leadCount: (c.selectedLeads || []).length,
      selectedLeads: undefined, // the list itself is not needed for an index view
      icp: icpByCampaign.get(String(c._id)) || null,
    })),
  });
});

/**
 * What an admin may still change, given how far the campaign has got.
 *
 * Name and description are always safe. Leads and email content are not:
 * once even one email has gone out, changing the recipient list or the copy
 * would make the campaign's own history describe something that never
 * happened. So those are frozen the moment sending begins.
 */
function editability(campaign, icp) {
  const sent = campaign.stats?.sentCount || 0;
  const notStarted = ['draft', 'scheduled'].includes(campaign.status) && sent === 0;

  return {
    canEditDetails: true,
    canEditLeads: notStarted,
    canEditSequence: notStarted,
    // Editing after the customer signed off means they approved something
    // other than what would now be sent. Allowed, but never silently.
    approvalWouldBeStale: !!icp && icp.status === 'approved' && notStarted,
    reason: notStarted
      ? null
      : sent > 0
      ? `${sent} email(s) have already been sent — recipients and content are locked`
      : `Campaign is ${campaign.status} — recipients and content are locked`,
  };
}

/**
 * GET /api/admin/campaigns/:id
 * Everything about one campaign: its recipients, the full text of all four
 * emails, its ICP state, what it will cost, and who has done what to it.
 */
const getAdminCampaign = asyncHandler(async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) {
    return next(new AppError('Invalid campaign id', 400));
  }

  const campaign = await Campaign.findById(req.params.id)
    .populate('userId', 'fullName email')
    .populate('createdByAdmin', 'fullName email')
    .populate('adminActions.adminId', 'fullName email')
    .populate('emailTemplateId', 'templateName subject emailBody')
    // Bodies included so the detail page can show what will actually be sent,
    // rather than just a template name.
    .populate('sequenceTemplates.templateId', 'templateName subject emailBody isActive attachments')
    .lean();

  if (!campaign) return next(new AppError('Campaign not found', 404));

  const [icp, plan] = await Promise.all([
    CampaignICP.findOne({ campaignId: campaign._id })
      .select('name status autoApproveAt sentForReviewAt approvedAt approvalSource userNote')
      .lean(),
    activePlanFor(campaign.userId?._id || campaign.userId),
  ]);

  const validLeads = (campaign.selectedLeads || []).filter((l) => isEmailLike(l.email));
  const creditsRequired = validLeads.length * (campaign.creditsPerEmail || 1);
  const credits = creditSummary(plan);

  res.json({
    success: true,
    data: {
      ...campaign,
      icp: icp || null,
      billing: {
        creditsRequired,
        ...credits,
        sufficient: credits.hasPlan && credits.remaining >= creditsRequired,
      },
      editable: editability(campaign, icp),
    },
  });
});

/**
 * PUT /api/admin/campaigns/:id
 * Revise a campaign the admin built.
 *
 * @body { name, description, selectedLeads, sequence, settings, scheduledAt, note }
 *
 * Only the fields present are touched. Leads and sequence are refused once
 * sending has begun, rather than partially applied.
 */
const updateAdminCampaign = asyncHandler(async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) {
    return next(new AppError('Invalid campaign id', 400));
  }

  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) return next(new AppError('Campaign not found', 404));

  const user = await User.findById(campaign.userId).select('fullName email').lean();
  if (!user) return next(new AppError('This campaign has no valid owner', 409));

  const icp = await CampaignICP.findOne({ campaignId: campaign._id }).lean();
  const rules = editability(campaign, icp);

  const { name, description, selectedLeads, sequence, settings, scheduledAt, note = '' } = req.body;
  const changed = [];

  // ── Name and description ────────────────────────────────────────────────
  if (name !== undefined) {
    if (!String(name).trim()) return next(new AppError('Campaign name cannot be empty', 400));
    if (String(name).trim() !== campaign.name) changed.push('name');
    campaign.name = String(name).trim();
  }
  if (description !== undefined) {
    if (String(description).trim() !== campaign.description) changed.push('description');
    campaign.description = String(description).trim();
  }

  // ── Recipients ──────────────────────────────────────────────────────────
  if (selectedLeads !== undefined) {
    if (!rules.canEditLeads) return next(new AppError(rules.reason, 409));
    if (!Array.isArray(selectedLeads) || selectedLeads.length === 0) {
      return next(new AppError('A campaign needs at least one recipient', 400));
    }

    const seen = new Set();
    const clean = [];
    selectedLeads.forEach((lead, i) => {
      const email = String(lead?.email || '').trim().toLowerCase();
      if (!isEmailLike(email) || seen.has(email)) return;
      seen.add(email);
      clean.push({
        leadId: String(lead.leadId || `manual_${i + 1}`),
        email,
        firstName: lead.firstName || '',
        lastName: lead.lastName || '',
        company: lead.company || '',
        industry: lead.industry || '',
        jobTitle: lead.jobTitle || '',
        location: lead.location || '',
        phoneNumber: lead.phoneNumber || '',
      });
    });

    if (!clean.length) {
      return next(new AppError('None of the supplied leads had a valid email address', 400));
    }
    if (clean.length !== campaign.selectedLeads.length) changed.push('recipients');
    campaign.selectedLeads = clean;
  }

  // ── The four emails ─────────────────────────────────────────────────────
  // Templates newly written here are created before the save; if the save then
  // fails they are rolled back, exactly as on create.
  let rollbackIds = [];
  if (sequence !== undefined) {
    if (!rules.canEditSequence) return next(new AppError(rules.reason, 409));

    const steps = await resolveSequenceTemplates({
      sequence,
      user,
      campaignName: campaign.name,
      adminId: req.user._id,
    });

    rollbackIds = steps.filter((s) => !s.reused).map((s) => s.template._id);
    campaign.emailTemplateId = steps.find((s) => s.key === 'initial').template._id;
    campaign.sequenceTemplates = steps.map((s) => ({
      step: SEQUENCE_KEYS.indexOf(s.key) + 1,
      key: s.key,
      templateId: s.template._id,
    }));
    changed.push('emails');
  }

  if (settings !== undefined) {
    campaign.settings = { ...campaign.settings.toObject?.() ?? campaign.settings, ...settings };
    changed.push('settings');
  }
  if (scheduledAt !== undefined) {
    campaign.scheduledAt = scheduledAt || undefined;
    changed.push('schedule');
  }

  if (!changed.length) {
    return res.json({ success: true, data: campaign, message: 'Nothing to change.' });
  }

  campaign.adminActions.push({
    action: 'updated',
    adminId: req.user._id,
    adminEmail: req.user.email,
    note: String(note).trim() || `Edited ${changed.join(', ')}`,
    at: new Date(),
  });

  try {
    await campaign.save();
  } catch (err) {
    await EmailTemplate.deleteMany({ _id: { $in: rollbackIds } }).catch(() => {});
    throw err;
  }

  await campaign.populate([
    { path: 'emailTemplateId', select: 'templateName subject emailBody' },
    { path: 'sequenceTemplates.templateId', select: 'templateName subject emailBody' },
  ]);

  // If the customer already approved, say so plainly — what they agreed to is
  // no longer what would be sent.
  const staleApproval =
    rules.approvalWouldBeStale && (changed.includes('emails') || changed.includes('recipients'));

  res.json({
    success: true,
    data: campaign,
    changed,
    staleApproval,
    message: staleApproval
      ? `Saved. ${user.email} approved an earlier version of this campaign — send the ICP again so they can approve what will actually go out.`
      : `Saved — updated ${changed.join(', ')}.`,
  });
});

/**
 * POST /api/admin/campaigns/:id/start
 * Start a customer's campaign.
 *
 * This mirrors campaignController.startCampaign exactly — same ICP gate, same
 * credit reservation against the CUSTOMER'S plan, same background processing.
 * The only difference is that the campaign is looked up by id rather than by
 * (id, owner), because the admin is not the owner.
 *
 * The ICP gate is not optional here. Consent to contact these people is the
 * customer's to give, and an approved ICP is that consent.
 */
const startCampaignForCustomer = asyncHandler(async (req, res, next) => {
  const campaign = await Campaign.findById(req.params.id).populate('emailTemplateId');
  if (!campaign) return next(new AppError('Campaign not found', 404));

  const owner = await User.findById(campaign.userId).select('fullName email').lean();
  if (!owner) return next(new AppError('This campaign has no valid owner', 409));

  if (!campaign.canBeStarted()) {
    return next(new AppError(
      `Campaign cannot be started while its status is "${campaign.status}"`,
      400
    ));
  }

  // ── ICP gate ────────────────────────────────────────────────────────────
  const icp = await CampaignICP.findOne({ campaignId: campaign._id });

  if (!icp) {
    return next(new AppError(
      'This campaign has no ICP yet. Create one and have the customer approve it before sending.',
      409
    ));
  }

  if (icp.status !== 'approved') {
    // The sweep may not have run since the deadline passed; treat an expired
    // window as approval here too, and record that it was automatic.
    if (CampaignICP.isPastDeadline(icp)) {
      icp.status = 'approved';
      icp.approvedAt = new Date();
      icp.approvalSource = 'auto';
      icp.autoApproveAt = undefined;
      await icp.save();
    } else {
      const hoursLeft = icp.hoursUntilAutoApprove;
      return res.status(409).json({
        success: false,
        code: icp.status === 'revision_requested' ? 'ICP_CHANGES_REQUESTED' : 'ICP_NOT_APPROVED',
        icpStatus: icp.status,
        hoursUntilAutoApprove: hoursLeft,
        message: icp.status === 'revision_requested'
          ? `${owner.email} has requested changes to this ICP. Revise it and send it back before starting.`
          : `${owner.email} has not approved this ICP yet. It approves automatically in ${hoursLeft ?? '—'} hour(s).`,
      });
    }
  }

  // ── Credits: the customer's plan pays, never the admin's ────────────────
  const validLeads = campaign.selectedLeads.filter((l) => l.email && l.email.includes('@'));
  const creditsRequired = validLeads.length * (campaign.creditsPerEmail || 1);

  const userPlan = await activePlanFor(campaign.userId);

  // ── PAYWALL (parked for testing — see config/testingFlags.js) ───────────
  if (!BYPASS_PAYWALL) {
    if (!userPlan) {
      return res.status(402).json({
        success: false,
        message: `${owner.email} has no active plan. They need to subscribe before this campaign can send.`,
        creditsRequired,
        remainingCredits: 0,
      });
    }

    if (!userPlan.hasEnoughCredits(creditsRequired)) {
      const remaining = Math.max(0, userPlan.totalCredits - userPlan.creditsUsed);
      return res.status(402).json({
        success: false,
        message: `${owner.email} needs ${creditsRequired} credits for ${validLeads.length} emails but has ${remaining}.`,
        creditsRequired,
        remainingCredits: remaining,
        leadsCount: validLeads.length,
      });
    }
  }
  // ────────────────────────────────────────────────────────────────────────

  // Still charged whenever the customer actually has a plan, so a funded
  // account behaves exactly as it will in production.
  if (userPlan) {
    userPlan.creditsUsed += creditsRequired;
    await userPlan.save();

    await UserCreditConsumption.create({
      userId: campaign.userId,
      userPlanId: userPlan._id,
      actionType: 'SEND_CAMPAIGN_EMAIL',
      creditsConsumed: creditsRequired,
      leadId: `campaign_${campaign._id}`,
      metadata: {
        campaignId: campaign._id,
        campaignName: campaign.name,
        leadsCount: validLeads.length,
        creditsPerEmail: campaign.creditsPerEmail || 1,
        type: 'reserve',
        startedByAdmin: String(req.user._id),
      },
    });
  }

  campaign.status = 'sending';
  campaign.startedAt = new Date();
  campaign.creditsReserved = creditsRequired;
  campaign.adminActions.push({
    action: 'started',
    adminId: req.user._id,
    adminEmail: req.user.email,
    note: `Started on behalf of ${owner.email} — ${creditsRequired} credits reserved for ${validLeads.length} emails`,
    at: new Date(),
  });
  await campaign.save();

  processCampaign(campaign._id).catch((err) => {
    console.error(`Background campaign processing failed for ${campaign._id}:`, err);
    Campaign.findByIdAndUpdate(campaign._id, {
      status: 'failed',
      $push: {
        errorLogs: {
          message: `Processing failed: ${err.message}`,
          errorType: 'sending',
          timestamp: new Date(),
        },
      },
    }).catch(console.error);
  });

  res.json({
    success: true,
    data: campaign,
    message: `Campaign started for ${owner.email} — ${creditsRequired} credits reserved for ${validLeads.length} emails`,
    creditsReserved: creditsRequired,
    remainingCredits: userPlan ? Math.max(0, userPlan.totalCredits - userPlan.creditsUsed) : 0,
  });
});

module.exports = {
  listCustomers,
  getCustomerContext,
  getSavedList,
  searchLeadsForCustomer,
  createCampaignForCustomer,
  listAdminCampaigns,
  getAdminCampaign,
  updateAdminCampaign,
  startCampaignForCustomer,
  // Email template library, managed for a customer
  listCustomerTemplates,
  uploadCustomerTemplateAttachment,
  createCustomerTemplate,
  updateCustomerTemplate,
  deleteCustomerTemplate,
  // Saved lead lists, managed for a customer
  createCustomerLeadList,
  deleteCustomerLeadList,
};
