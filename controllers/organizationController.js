// controllers/organizationController.js
//
// "Which companies am I in, and what may I do in this one?"
//
// Everything here is read-only or a preference change. Creating orgs,
// inviting people and changing roles come next; this first slice exists so
// the frontend can render the right navigation before any behaviour changes.

const mongoose = require('mongoose');
const Organization = require('../models/Organization');
const Membership = require('../models/Membership');
const User = require('../models/User');
const { AppError, asyncHandler } = require('../middleware/errorHandler');
const { capabilitiesFor, visibilityFor } = require('../config/permissions');

/** Shape one membership for the client. Never leaks another org's detail. */
function describe(membership) {
  const org = membership.organizationId;
  const orgIsPopulated = org && typeof org === 'object' && org.name;

  return {
    organization: orgIsPopulated
      ? { _id: org._id, name: org.name, slug: org.slug, isPersonal: !!org.isPersonal }
      : { _id: org },
    role: membership.role,
    scope: membership.scope,
    status: membership.status,
    expiresAt: membership.expiresAt || null,
    // Only meaningful for a contractor, and only ever their own list.
    campaignIds: membership.role === 'contractor'
      ? (membership.campaignIds || []).map(String)
      : undefined,
  };
}

/**
 * GET /api/organizations/me
 *
 * Every org the caller belongs to, which one is current, and the flat
 * capability list the UI renders from.
 *
 * The capability list is a convenience for hiding controls — every route
 * still checks independently, because a hidden button is UX, not security.
 */
const getMyOrganizations = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.id;

  const memberships = await Membership.forUser(userId);
  const usable = memberships.filter((m) => m.isCurrentlyActive());

  // req.membership is set by attachOrgContext when it resolved one.
  const current = req.membership || null;

  res.json({
    success: true,
    data: {
      organizations: usable.map(describe),
      current: current
        ? {
            ...describe(current),
            capabilities: capabilitiesFor(current),
            visibility: visibilityFor(current),
          }
        : null,
      // True for someone who has never been migrated or invited anywhere.
      // The UI should treat this as "no workspace yet" rather than an error.
      hasNoOrganization: usable.length === 0,
      // Platform staff. Separate axis — not a role inside any organization.
      isPlatformAdmin: !!req.user.isAdmin,
    },
  });
});

/**
 * POST /api/organizations/switch
 * @body { organizationId }
 *
 * Remembers which org the caller is working in. Membership is re-checked
 * here and again on every subsequent request — storing it is a convenience,
 * never a grant.
 */
const switchOrganization = asyncHandler(async (req, res, next) => {
  const userId = req.user._id || req.user.id;
  const { organizationId } = req.body;

  if (!organizationId || !mongoose.Types.ObjectId.isValid(String(organizationId))) {
    return next(new AppError('A valid organizationId is required', 400));
  }

  const membership = await Membership.forUserInOrg(userId, organizationId);
  if (!membership || !membership.isCurrentlyActive()) {
    return next(new AppError('You are not a member of this organization', 403));
  }

  await User.updateOne({ _id: userId }, { $set: { lastActiveOrgId: organizationId } });

  await membership.populate('organizationId', 'name slug isPersonal');

  res.json({
    success: true,
    data: {
      ...describe(membership),
      capabilities: capabilitiesFor(membership),
      visibility: visibilityFor(membership),
    },
    message: `Now working in ${membership.organizationId.name}`,
  });
});

/**
 * GET /api/organizations/:id/members
 *
 * The people in one organization. Requires members.view, so a contractor
 * cannot enumerate the customer's staff.
 */
const listMembers = asyncHandler(async (req, res, next) => {
  if (String(req.params.id) !== String(req.organizationId)) {
    // Asking about an org other than the resolved one — refuse rather than
    // quietly answering about a different company.
    return next(new AppError('You are not a member of this organization', 403));
  }

  const members = await Membership.find({ organizationId: req.organizationId })
    .populate('userId', 'fullName email')
    .populate('invitedBy', 'fullName email')
    .sort({ role: 1, createdAt: 1 })
    .lean();

  res.json({
    success: true,
    count: members.length,
    data: members.map((m) => ({
      _id: m._id,
      user: m.userId
        ? { _id: m.userId._id, fullName: m.userId.fullName, email: m.userId.email }
        : null,
      inviteEmail: m.inviteEmail || null,
      role: m.role,
      scope: m.scope,
      status: m.status,
      expiresAt: m.expiresAt || null,
      invitedBy: m.invitedBy ? m.invitedBy.email : null,
      joinedAt: m.acceptedAt || m.createdAt,
    })),
  });
});

/**
 * GET /api/organizations/current
 * The current org's own details.
 */
const getCurrentOrganization = asyncHandler(async (req, res, next) => {
  const org = await Organization.findById(req.organizationId).lean();
  if (!org) return next(new AppError('Organization not found', 404));

  const memberCount = await Membership.countDocuments({
    organizationId: org._id,
    status: 'active',
  });

  res.json({
    success: true,
    data: {
      _id: org._id,
      name: org.name,
      slug: org.slug,
      isPersonal: org.isPersonal,
      status: org.status,
      memberCount,
      verifiedDomains: org.verifiedDomains || [],
      autoJoinOnVerifiedDomain: !!org.autoJoinOnVerifiedDomain,
      createdAt: org.createdAt,
    },
  });
});

module.exports = {
  getMyOrganizations,
  switchOrganization,
  listMembers,
  getCurrentOrganization,
};
