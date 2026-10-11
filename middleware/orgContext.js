// middleware/orgContext.js
//
// Decides, per request, whether the caller is acting alone or as part of an
// enterprise organization — and everything that follows from that.
//
//   individual account → no organization. Data is owned and filtered by
//                        userId, exactly as it always has been.
//   enterprise account → one organization. Data is filtered by
//                        organizationId, and the member's role decides what
//                        they may see and do.
//
// The organization is never taken from the browser. It is read from the
// caller's own active Membership, so there is no id a client could swap to
// reach another company's records.
//
// `protect` calls resolveOrgContext on every authenticated request, so the
// context is already on req by the time any route runs.

const mongoose = require('mongoose');
const Membership = require('../models/Membership');
const Organization = require('../models/Organization');
const User = require('../models/User');
const { AppError } = require('./errorHandler');
const { can, capabilitiesFor, visibilityFor } = require('../config/permissions');

/**
 * Resolve org context onto the request. Called by `protect`.
 *
 * For an individual account this is a no-op costing no queries. For an
 * enterprise account it sets:
 *
 *   req.membership       the caller's active Membership
 *   req.organization     { _id, name, slug, ownerUserId }
 *   req.organizationId   string
 *   req.orgCapabilities  flat capability list
 *   req.orgVisibility    { mode: 'all' | 'own' }
 *
 * Throws 403 when an enterprise account has no usable membership — a
 * suspended member must lose access everywhere, not fall back to behaving
 * like an individual with an empty workspace.
 */
async function resolveOrgContext(req) {
  const user = req.user;
  if (!user || user.accountType !== 'enterprise') return;

  const membership = await Membership.activeForUser(user._id);
  if (!membership) {
    throw new AppError(
      'Your access to this organization has been removed. Please contact your administrator.',
      403
    );
  }

  const organization = await Organization.findById(membership.organizationId)
    .select('name slug status ownerUserId')
    .lean();
  if (!organization || organization.status !== 'active') {
    throw new AppError('This organization is not active. Please contact support.', 403);
  }

  req.membership = membership;
  req.organization = organization;
  req.organizationId = String(organization._id);
  req.orgCapabilities = capabilitiesFor(membership);
  req.orgVisibility = visibilityFor(membership);
}

/** Require an enterprise context — use on the organization's own routes. */
const requireOrg = (req, res, next) => {
  if (!req.membership || !req.organizationId) {
    return next(new AppError('This is only available to enterprise accounts', 403));
  }
  return next();
};

/**
 * Require a capability.
 *
 *     router.post('/:id/start', requireCapability('campaign.start'), start)
 *
 * An individual account has no membership and passes: it owns its data
 * outright, and there is nobody else whose limits could apply. Only enterprise
 * members are held to their role.
 */
const requireCapability = (capability) => (req, res, next) => {
  if (!req.membership) return next();
  if (!can(req.membership, capability)) {
    return next(new AppError(
      `Your role (${req.membership.role}) does not allow this action`,
      403
    ));
  }
  return next();
};

/** Same check for use inside a controller. Individuals always pass. */
function hasCapability(req, capability) {
  if (!req.membership) return true;
  return can(req.membership, capability);
}

/**
 * The filter every query for owned records should start from. This is the
 * one to reach for.
 *
 *   individual            → { userId }
 *   admin / manager       → { organizationId }
 *   employee              → { organizationId, userId }
 *
 * Built here rather than hand-written per controller, because the dangerous
 * bug in a multi-tenant system is the one query that forgets the org — and
 * thirty hand-written filters is thirty chances to forget.
 *
 * @param {object} req
 * @param {string} [ownerField]  field naming the creating user
 */
function tenantFilter(req, ownerField = 'userId') {
  const userId = req.user && (req.user._id || req.user.id);

  if (!req.membership) {
    return { [ownerField]: userId };
  }

  const filter = { organizationId: req.organizationId };
  const vis = req.orgVisibility || { mode: 'own' };
  if (vis.mode !== 'all') filter[ownerField] = userId;
  return filter;
}

/**
 * What to stamp onto a NEW record. Empty for an individual. userId keeps its
 * own meaning — who created this — and is set by the caller as before.
 */
function tenantStamp(req) {
  return req.organizationId ? { organizationId: req.organizationId } : {};
}

/**
 * The account that holds this caller's plan, credits, purchased projects and
 * business profile.
 *
 *   individual → themselves
 *   enterprise → the organization's owning admin
 *
 * Every plan / credit / project lookup should key on this instead of
 * req.user._id. That one substitution is what gives a whole team a single
 * shared pool.
 */
function accountUserId(req) {
  if (req.organization && req.organization.ownerUserId) {
    return req.organization.ownerUserId;
  }
  return req.user && (req.user._id || req.user.id);
}

/**
 * The same resolution for code with no request in hand — background jobs,
 * and the legacy lead-credit endpoints that are handed a user id.
 *
 * Returns the account whose pool is drawn on, plus the organization and
 * membership when the user is an enterprise member (both null otherwise).
 */
async function actorContextFor(userId) {
  const individual = { accountUserId: userId, organizationId: null, membership: null };
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return individual;

  const user = await User.findById(userId).select('accountType organizationId').lean();
  if (!user || user.accountType !== 'enterprise' || !user.organizationId) return individual;

  const [organization, membership] = await Promise.all([
    Organization.findById(user.organizationId).select('ownerUserId').lean(),
    Membership.activeForUser(userId),
  ]);
  if (!organization) return individual;

  return {
    accountUserId: organization.ownerUserId,
    organizationId: organization._id,
    membership,
  };
}

/** Just the account id — see actorContextFor. */
async function accountUserIdFor(userId) {
  return (await actorContextFor(userId)).accountUserId;
}

/**
 * What the client needs to know about the caller's place in their
 * organization: which company, which role, and the flat capability list the
 * UI renders from. The list is a convenience for hiding controls — every
 * route still checks independently.
 */
function describeOrgContext(membership, organization, userId) {
  if (!membership || !organization) return null;
  return {
    _id: organization._id,
    name: organization.name,
    slug: organization.slug,
    role: membership.role,
    isOwner: String(organization.ownerUserId) === String(userId),
    capabilities: capabilitiesFor(membership),
    visibility: visibilityFor(membership),
  };
}

/** The same summary, from the request `protect` already resolved. */
function orgSummaryFromReq(req) {
  return describeOrgContext(req.membership, req.organization, req.user && req.user._id);
}

/**
 * The same summary for a user with no request context yet — login and
 * registration, which run before `protect`. Null for an individual account,
 * and null for an enterprise account whose membership is no longer active.
 */
async function orgSummaryForUser(user) {
  if (!user || user.accountType !== 'enterprise') return null;

  const membership = await Membership.activeForUser(user._id);
  if (!membership) return null;

  const organization = await Organization.findById(membership.organizationId)
    .select('name slug status ownerUserId')
    .lean();
  if (!organization || organization.status !== 'active') return null;

  return describeOrgContext(membership, organization, user._id);
}

module.exports = {
  resolveOrgContext,
  describeOrgContext,
  orgSummaryFromReq,
  orgSummaryForUser,
  requireOrg,
  requireCapability,
  hasCapability,
  tenantFilter,
  tenantStamp,
  accountUserId,
  accountUserIdFor,
  actorContextFor,
};
