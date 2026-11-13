// controllers/partnerController.js
//
// The partner (agency) app's own API. Everything here is behind
// kindGate('partner') + protect + requireKind('partner') + requireOrg, so the
// caller is always a member of a partner organization, and the organization is
// always their own — never one named in the request.

const mongoose = require('mongoose');
const Organization = require('../models/Organization');
const Membership = require('../models/Membership');
const Engagement = require('../models/Engagement');
const ProjectUser = require('../models/ProjectUser');
const ProjectCatalog = require('../models/ProjectCatalog');
const User = require('../models/User');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { orgSummaryFromReq } = require('../middleware/orgContext');
const { audit } = require('../utils/audit');

const TEAM_SIZES = ['1', '2-10', '11-50', '51-200', '200+'];
const MAX_SERVICES = 12;

// A profile is complete once a business could tell what the agency does.
const isComplete = (profile = {}) =>
  !!(profile.description && profile.services && profile.services.length > 0 && profile.teamSize);

const shapeProfile = (organization) => {
  const profile = organization.profile || {};
  return {
    name: organization.name,
    tagline: profile.tagline || '',
    description: profile.description || '',
    website: profile.website || '',
    location: profile.location || '',
    teamSize: profile.teamSize || '',
    services: profile.services || [],
    verified: !!profile.verified,
    completed: !!profile.completedAt,
  };
};

/**
 * @desc    The partner home: organization, profile and getting-started state
 * @route   GET /api/partner/me
 */
const getPartnerHome = asyncHandler(async (req, res) => {
  const organization = await Organization.findById(req.organizationId).lean();
  const [memberCount, clientProjectCount, invitationCount] = await Promise.all([
    Membership.countDocuments({ organizationId: req.organizationId, status: { $in: ['active', 'invited'] } }),
    Engagement.countDocuments(visibleFilter(req, ['active', 'paused'])),
    Engagement.countDocuments(invitationFilter(req)),
  ]);

  res.json({
    success: true,
    data: {
      organization: orgSummaryFromReq(req),
      profile: shapeProfile(organization),
      memberCount,
      clientProjectCount,
      invitationCount,
    },
  });
});

/**
 * @desc    Update the agency's profile (and name)
 * @route   PUT /api/partner/profile
 * @access  org.manage
 */
const updatePartnerProfile = asyncHandler(async (req, res, next) => {
  const { name, tagline, description, website, location, teamSize, services } = req.body;

  if (teamSize !== undefined && teamSize !== '' && !TEAM_SIZES.includes(teamSize)) {
    return next(new AppError('Choose a team size from the list', 400));
  }
  if (services !== undefined && !Array.isArray(services)) {
    return next(new AppError('Services must be a list', 400));
  }

  const organization = await Organization.findById(req.organizationId);
  const before = shapeProfile(organization);

  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (trimmed.length < 2) return next(new AppError('Agency name must be at least 2 characters', 400));
    organization.name = trimmed.slice(0, 120);
  }

  const profile = organization.profile || {};
  const text = (v) => String(v ?? '').trim();
  if (tagline !== undefined) profile.tagline = text(tagline);
  if (description !== undefined) profile.description = text(description);
  if (website !== undefined) profile.website = text(website);
  if (location !== undefined) profile.location = text(location);
  if (teamSize !== undefined) profile.teamSize = teamSize || undefined;
  if (services !== undefined) {
    // Trimmed, de-duplicated, capped — it's a short list of what they do
    profile.services = [...new Set(services.map(text).filter(Boolean))].slice(0, MAX_SERVICES);
  }
  if (!profile.completedAt && isComplete(profile)) profile.completedAt = new Date();
  organization.profile = profile;

  await organization.save();

  await audit(req, 'partner.profile.updated', {
    target: { type: 'Organization', id: organization._id },
    summary: `${req.user.fullName} updated the agency profile`,
    details: { completedNow: !before.completed && !!profile.completedAt },
  });

  res.json({ success: true, message: 'Profile saved', data: { profile: shapeProfile(organization) } });
});

// ── Client projects (engagements) ───────────────────────────────────────────
//
// A worker never browses projects: everything here is an invitation a
// business sent, or a project the worker accepted.

// Admins and leads see all of the agency's engagements; others only the
// ones they've been put on.
const seesAllEngagements = (req) => ['admin', 'manager'].includes(req.membership?.role);

/** Engagements of this agency the caller may see, in the given statuses. */
function visibleFilter(req, statuses) {
  const filter = { partnerOrgId: req.organizationId, status: { $in: statuses } };
  if (!seesAllEngagements(req)) filter['members.userId'] = req.user._id;
  return filter;
}

/**
 * Open invitations for this agency: addressed to it, or — before it was
 * known — to the caller's own email. Only admins act on invitations.
 */
function invitationFilter(req) {
  if (!seesAllEngagements(req)) return { _id: null };
  return {
    status: 'invited',
    inviteExpires: { $gt: new Date() },
    $or: [
      { partnerOrgId: req.organizationId },
      { partnerOrgId: null, invitedEmail: String(req.user.email).toLowerCase() },
    ],
  };
}

/** Business names, project titles and assigned people for a list of engagements. */
async function describeEngagements(engagements) {
  const bizIds = [...new Set(engagements.map((e) => String(e.businessOrgId)))];
  const projIds = [...new Set(engagements.map((e) => String(e.projectInstanceId)))];
  const userIds = [...new Set(engagements.flatMap((e) => (e.members || []).map((m) => String(m.userId))))];

  const [bizs, projects, users] = await Promise.all([
    Organization.find({ _id: { $in: bizIds } }).select('name').lean(),
    ProjectUser.find({ _id: { $in: projIds } }).select('projectSlug catalogId').lean(),
    User.find({ _id: { $in: userIds } }).select('fullName email').lean(),
  ]);
  const catalogIds = projects.map((p) => p.catalogId).filter(Boolean);
  const catalogs = await ProjectCatalog.find({ _id: { $in: catalogIds } }).select('title tagline theme').lean();

  const bizById = new Map(bizs.map((b) => [String(b._id), b]));
  const projById = new Map(projects.map((p) => [String(p._id), p]));
  const catById = new Map(catalogs.map((c) => [String(c._id), c]));
  const userById = new Map(users.map((u) => [String(u._id), u]));

  return engagements.map((e) => {
    const project = projById.get(String(e.projectInstanceId));
    const catalog = project?.catalogId ? catById.get(String(project.catalogId)) : null;
    return {
      _id: e._id,
      status: e.status,
      business: { name: bizById.get(String(e.businessOrgId))?.name || 'A business' },
      project: {
        _id: e.projectInstanceId,
        slug: project?.projectSlug || e.projectSlug,
        title: catalog?.title || e.projectSlug,
        tagline: catalog?.tagline || '',
      },
      grants: e.grants,
      members: (e.members || []).map((m) => {
        const u = userById.get(String(m.userId));
        return { userId: m.userId, fullName: u?.fullName || 'Former member', email: u?.email || '' };
      }),
      message: e.message || '',
      invitedAt: e.createdAt,
      inviteExpires: e.status === 'invited' ? e.inviteExpires : null,
      acceptedAt: e.acceptedAt || null,
    };
  });
}

/**
 * @desc    Invitations waiting for this agency, and the client projects it works on
 * @route   GET /api/partner/projects
 */
const listClientProjects = asyncHandler(async (req, res) => {
  const [invitations, projects] = await Promise.all([
    Engagement.find(invitationFilter(req)).sort({ createdAt: -1 }).lean(),
    Engagement.find(visibleFilter(req, ['active', 'paused', 'ended'])).sort({ updatedAt: -1 }).lean(),
  ]);
  res.json({
    success: true,
    data: {
      invitations: await describeEngagements(invitations),
      projects: await describeEngagements(projects),
    },
  });
});

/**
 * @desc    Preview an invitation from its join link (no sign-in needed)
 * @route   GET /api/partner/invites/:token
 *
 * Shows only who is inviting and to what — enough to decide whether to sign
 * in or create a partner account. Nothing about the project's work.
 */
const previewInvite = asyncHandler(async (req, res, next) => {
  const engagement = await Engagement.findByInviteToken(req.params.token);
  if (!engagement) return next(new AppError('This invitation is invalid, expired or already used', 404));

  const [described] = await describeEngagements([engagement.toObject()]);
  const inviter = engagement.invitedBy ? await User.findById(engagement.invitedBy).select('fullName').lean() : null;
  res.json({
    success: true,
    data: {
      businessName: described.business.name,
      projectTitle: described.project.title,
      projectTagline: described.project.tagline,
      invitedEmail: engagement.invitedEmail,
      invitedBy: inviter?.fullName || null,
      message: engagement.message || '',
      expiresAt: engagement.inviteExpires,
    },
  });
});

/**
 * May the caller answer this invitation for their agency?
 *   • only an agency admin takes on (or turns down) a client project
 *   • addressed to an agency already → it must be the caller's agency
 *   • addressed to an email only → it must be the caller's own email, so a
 *     forwarded link can't be used by someone else
 */
function assertCanAnswer(req, engagement) {
  if (!seesAllEngagements(req) || req.membership.role !== 'admin') {
    throw new AppError('Only your agency\'s admin can accept or decline client projects', 403);
  }
  if (engagement.partnerOrgId) {
    if (String(engagement.partnerOrgId) !== String(req.organizationId)) {
      throw new AppError('This invitation is for another agency', 403);
    }
  } else if (engagement.invitedEmail !== String(req.user.email).toLowerCase()) {
    throw new AppError(`This invitation was sent to ${engagement.invitedEmail}. Sign in with that partner account to accept it.`, 403);
  }
}

async function answer(req, res, engagement, accept) {
  assertCanAnswer(req, engagement);

  if (accept) {
    const already = await Engagement.findOne({
      _id: { $ne: engagement._id },
      projectInstanceId: engagement.projectInstanceId,
      partnerOrgId: req.organizationId,
      status: { $in: ['active', 'paused'] },
    }).lean();
    if (already) throw new AppError('Your agency is already working on this project', 409);

    engagement.status = 'active';
    engagement.partnerOrgId = req.organizationId;
    engagement.acceptedBy = req.user._id;
    engagement.acceptedAt = new Date();
    if (!engagement.hasMember(req.user._id)) {
      engagement.members.push({ userId: req.user._id, addedBy: req.user._id });
    }
  } else {
    engagement.status = 'declined';
    engagement.partnerOrgId = engagement.partnerOrgId || req.organizationId;
    engagement.decidedAt = new Date();
  }
  // The link works once
  engagement.inviteTokenHash = undefined;
  engagement.inviteExpires = undefined;
  await engagement.save();

  const [described] = await describeEngagements([engagement.toObject()]);
  await audit(req, accept ? 'engagement.accepted' : 'engagement.declined', {
    tenantOrgId: engagement.businessOrgId,
    via: 'partner',
    target: { type: 'Engagement', id: engagement._id },
    projectInstanceId: engagement.projectInstanceId,
    summary: `${req.organization.name} ${accept ? 'accepted' : 'declined'} the invitation to ${described.project.title}`,
  });

  res.json({
    success: true,
    message: accept ? `You're now working on ${described.project.title} for ${described.business.name}` : 'Invitation declined',
    data: { engagement: described },
  });
}

/**
 * @desc    Accept / decline from the join link
 * @route   POST /api/partner/invites/:token/accept | /decline
 */
const acceptInvite = asyncHandler(async (req, res, next) => {
  const engagement = await Engagement.findByInviteToken(req.params.token);
  if (!engagement) return next(new AppError('This invitation is invalid, expired or already used', 404));
  return answer(req, res, engagement, true);
});
const declineInvite = asyncHandler(async (req, res, next) => {
  const engagement = await Engagement.findByInviteToken(req.params.token);
  if (!engagement) return next(new AppError('This invitation is invalid, expired or already used', 404));
  return answer(req, res, engagement, false);
});

/** An open invitation this agency can see, by id (from the Client projects list). */
async function openInvitation(req, id) {
  if (!mongoose.Types.ObjectId.isValid(String(id))) throw new AppError('Not found', 404);
  const engagement = await Engagement.findOne({ _id: id, ...invitationFilter(req) });
  if (!engagement) throw new AppError('Not found', 404);
  return engagement;
}

/**
 * @desc    Accept / decline from the Client projects list
 * @route   POST /api/partner/engagements/:id/accept | /decline
 */
const acceptById = asyncHandler(async (req, res) => answer(req, res, await openInvitation(req, req.params.id), true));
const declineById = asyncHandler(async (req, res) => answer(req, res, await openInvitation(req, req.params.id), false));

/** An engagement of this agency the caller may see, or a 404. */
async function visibleEngagement(req, id, statuses = ['active', 'paused', 'ended']) {
  if (!mongoose.Types.ObjectId.isValid(String(id))) throw new AppError('Not found', 404);
  const engagement = await Engagement.findOne({ _id: id, ...visibleFilter(req, statuses) });
  if (!engagement) throw new AppError('Not found', 404);
  return engagement;
}

/**
 * @desc    One client project: the client, the project brief and who works on it
 * @route   GET /api/partner/engagements/:id
 */
const getClientProject = asyncHandler(async (req, res) => {
  const engagement = await visibleEngagement(req, req.params.id);
  const [described] = await describeEngagements([engagement.toObject()]);

  const project = await ProjectUser.findById(engagement.projectInstanceId).select('catalogId').lean();
  const catalog = project?.catalogId
    ? await ProjectCatalog.findById(project.catalogId)
      .select('title description deliverables milestones tools howItWorks kpis duration humanApprovalTasks')
      .lean()
    : null;

  // The agency's people, so a lead can choose who works on it
  const team = seesAllEngagements(req)
    ? await Membership.find({ organizationId: req.organizationId, status: 'active' }).populate('userId', 'fullName email').lean()
    : [];

  res.json({
    success: true,
    data: {
      engagement: described,
      brief: catalog
        ? {
          description: catalog.description || '',
          deliverables: catalog.deliverables || [],
          milestones: catalog.milestones || [],
          tools: catalog.tools || [],
          howItWorks: catalog.howItWorks || [],
          kpis: catalog.kpis || [],
          duration: catalog.duration || '',
        }
        : null,
      team: team.filter((m) => m.userId).map((m) => ({ userId: m.userId._id, fullName: m.userId.fullName, email: m.userId.email, role: m.role })),
      canAssign: seesAllEngagements(req) && engagement.status !== 'ended',
    },
  });
});

/**
 * @desc    Choose who from the agency works on a client project
 * @route   PUT /api/partner/engagements/:id/members   { userIds: [] }
 * @access  agency admin or lead
 */
const setEngagementMembers = asyncHandler(async (req, res, next) => {
  if (!seesAllEngagements(req)) return next(new AppError('Only your agency\'s admin or a lead can assign people', 403));
  const engagement = await visibleEngagement(req, req.params.id, ['active', 'paused']);

  const ids = [...new Set((Array.isArray(req.body.userIds) ? req.body.userIds : []).map(String))];
  if (ids.length === 0) return next(new AppError('Keep at least one person on the project', 400));
  if (!ids.every((id) => mongoose.Types.ObjectId.isValid(id))) return next(new AppError('Unknown person', 400));

  // Only active members of this agency can be put on its client projects
  const valid = await Membership.find({ organizationId: req.organizationId, status: 'active', userId: { $in: ids } }).select('userId').lean();
  if (valid.length !== ids.length) return next(new AppError('Everyone assigned must be an active member of your agency', 400));

  const before = new Map((engagement.members || []).map((m) => [String(m.userId), m]));
  engagement.members = ids.map((id) => before.get(id) || { userId: id, addedBy: req.user._id, addedAt: new Date() });
  await engagement.save();

  await audit(req, 'engagement.members_changed', {
    tenantOrgId: engagement.businessOrgId,
    via: 'partner',
    target: { type: 'Engagement', id: engagement._id },
    projectInstanceId: engagement.projectInstanceId,
    summary: `${req.user.fullName} changed who works on this project (${ids.length})`,
  });

  const [described] = await describeEngagements([engagement.toObject()]);
  res.json({ success: true, data: { engagement: described } });
});

module.exports = {
  getPartnerHome,
  updatePartnerProfile,
  listClientProjects,
  previewInvite,
  acceptInvite,
  declineInvite,
  acceptById,
  declineById,
  getClientProject,
  setEngagementMembers,
  TEAM_SIZES,
};
