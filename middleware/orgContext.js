// middleware/orgContext.js
//
// Works out, per request, which organization the caller acts in and what
// their role there allows.
//
// Every account — business, partner or platform — belongs to exactly one
// organization. Data is filtered by organizationId and the member's role
// decides what they may see and do. An account with no usable membership gets
// nothing: there is no "individual" fallback any more.
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
 * Resolve org context onto the request. Called by `protect`. Sets:
 *
 *   req.membership       the caller's active Membership
 *   req.organization     { _id, name, slug, ownerUserId }
 *   req.organizationId   string
 *   req.orgCapabilities  flat capability list
 *   req.orgVisibility    { mode: 'all' | 'own' }
 *
 * Throws 403 when the account has no usable membership — a suspended member
 * must lose access everywhere, not carry on with an empty workspace.
 */
async function resolveOrgContext(req) {
  const user = req.user;
  if (!user) return;

  const membership = await Membership.activeForUser(user._id);
  if (!membership) {
    // TEMPORARY: Karya staff are still business accounts flagged isAdmin,
    // reaching the admin pages through restrictTo('admin'). They keep working
    // with no organization until the Karya console (platform accounts)
    // replaces them; nothing that checks a capability lets them through.
    if (user.isAdmin) return;
    throw new AppError(
      'Your access to this organization has been removed. Please contact your administrator.',
      403
    );
  }

  const organization = await Organization.findById(membership.organizationId)
    .select('name slug type status settings ownerUserId')
    .lean();
  if (!organization || organization.status !== 'active') {
    throw new AppError('This organization is not active. Please contact support.', 403);
  }

  req.membership = membership;
  req.organization = organization;
  req.organizationId = String(organization._id);
  req.orgCapabilities = capabilitiesFor(membership, organization);
  req.orgVisibility = visibilityFor(membership);
}

/** Require an organization context — use on the organization's own routes. */
const requireOrg = (req, res, next) => {
  if (!req.membership || !req.organizationId) {
    return next(new AppError('This needs an organization account', 403));
  }
  return next();
};

const capabilityDenied = (req) => new AppError(
  req.membership
    ? `Your role (${req.membership.role}) does not allow this action`
    : 'Your account does not allow this action',
  403
);

/**
 * Require a capability.
 *
 *     router.post('/:id/start', requireCapability('campaign.start'), start)
 *
 * No membership, no capability: denied.
 */
const requireCapability = (capability) => (req, res, next) => {
  if (!hasCapability(req, capability)) return next(capabilityDenied(req));
  return next();
};

/** Require at least one of several capabilities. */
const requireAnyCapability = (...capabilities) => (req, res, next) => {
  if (!capabilities.some((c) => hasCapability(req, c))) return next(capabilityDenied(req));
  return next();
};

/**
 * Same check for use inside a controller.
 *
 * A worker (agency / expert) inside a client's project holds exactly what that
 * project's engagement grants — their own organization's role table doesn't
 * apply there (see middleware/projectContext.js).
 */
function hasCapability(req, capability) {
  if (req.engagement) return (req.engagement.grants || []).includes(capability);
  if (!req.membership || !req.organization) return false;
  return can(req.membership, req.organization, capability);
}

/**
 * The filter every query for owned records should start from. This is the
 * one to reach for.
 *
 *   admin / manager       → { organizationId }
 *   employee              → { organizationId, userId }
 *   + inside a project    → … plus that project (see projectScopeFilter)
 *
 * Throws without an organization: a query with no tenant in it is exactly the
 * bug this exists to prevent.
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

  if (!req.membership || !req.organizationId) {
    throw new AppError('This needs an organization account', 403);
  }

  // A worker inside a client's project works on the CLIENT's records, and
  // only that project's: the business's organization, strictly scoped.
  if (req.engagement) {
    return { organizationId: req.engagement.businessOrgId, ...projectScopeFilter(req) };
  }

  const filter = { organizationId: req.organizationId };
  const vis = req.orgVisibility || { mode: 'own' };
  if (vis.mode !== 'all') filter[ownerField] = userId;
  Object.assign(filter, projectScopeFilter(req));
  return filter;
}

/**
 * The project part of tenantFilter — set only on the routers that run
 * projectContext (middleware/projectContext.js), and only when the request
 * named a project.
 *
 *   strict  → { projectInstanceId: id }                (partners: that project only)
 *   lenient → { projectInstanceId: { $in: [id, null] } } (business: + unassigned)
 *
 * The id is an ObjectId so the same filter works in find() and in aggregates.
 */
function projectScopeFilter(req) {
  if (!req.project || !req.project._id) return {};
  const id = new mongoose.Types.ObjectId(String(req.project._id));
  return req.projectScope === 'strict'
    ? { projectInstanceId: id }
    : { projectInstanceId: { $in: [id, null] } };
}

/**
 * What to stamp onto a NEW record. userId keeps its own meaning — who created
 * this — and is set by the caller as before.
 */
function tenantStamp(req) {
  // What a worker builds in a client's project belongs to the client
  const ownerOrgId = req.engagement ? req.engagement.businessOrgId : req.organizationId;
  return {
    ...(ownerOrgId ? { organizationId: ownerOrgId } : {}),
    // New work made inside a project belongs to that project
    ...(req.project && req.project._id ? { projectInstanceId: req.project._id } : {}),
  };
}

/**
 * The account that holds this caller's plan, credits, purchased projects and
 * business profile: the organization's owning admin.
 *
 * Every plan / credit / project lookup should key on this instead of
 * req.user._id. That one substitution is what gives a whole team a single
 * shared pool.
 */
function accountUserId(req) {
  // Inside a client's project the client pays: their plan, their credits
  if (req.engagement && req.engagement.businessOwnerUserId) {
    return req.engagement.businessOwnerUserId;
  }
  if (req.organization && req.organization.ownerUserId) {
    return req.organization.ownerUserId;
  }
  return req.user && (req.user._id || req.user.id);
}

/**
 * The same resolution for code with no request in hand — background jobs.
 *
 * Returns the account whose pool is drawn on, plus the organization and
 * membership (both null for an account with no organization, e.g. legacy staff).
 */
async function actorContextFor(userId) {
  const noOrg = { accountUserId: userId, organizationId: null, organization: null, membership: null };
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return noOrg;

  const user = await User.findById(userId).select('organizationId').lean();
  if (!user || !user.organizationId) return noOrg;

  const [organization, membership] = await Promise.all([
    Organization.findById(user.organizationId).select('ownerUserId type status settings').lean(),
    Membership.activeForUser(userId),
  ]);
  if (!organization) return noOrg;

  return {
    accountUserId: organization.ownerUserId,
    organizationId: organization._id,
    organization,
    membership,
  };
}

/**
 * hasCapability for code with no request in hand — e.g. the AI agent, which
 * only carries a user id. Same rule: no active membership, no capability.
 */
async function userHasCapability(userId, capability) {
  const { membership, organization } = await actorContextFor(userId);
  if (!membership || !organization || organization.status !== 'active') return false;
  return can(membership, organization, capability);
}

/**
 * The account that pays for a record owned by an organization — e.g. a
 * campaign being sent: whoever built it (staff, a worker, an employee), the
 * owning company's plan and credits are used.
 */
async function accountUserIdForOrg(organizationId) {
  if (!organizationId) return null;
  const org = await Organization.findById(organizationId).select('ownerUserId').lean();
  return org ? org.ownerUserId : null;
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
    type: organization.type,
    selfServe: !!organization.settings?.selfServe,
    role: membership.role,
    isOwner: String(organization.ownerUserId) === String(userId),
    capabilities: capabilitiesFor(membership, organization),
    visibility: visibilityFor(membership),
  };
}

/** The same summary, from the request `protect` already resolved. */
function orgSummaryFromReq(req) {
  return describeOrgContext(req.membership, req.organization, req.user && req.user._id);
}

/**
 * The same summary for a user with no request context yet — login and
 * registration, which run before `protect`. Null when the account has no
 * active membership.
 */
async function orgSummaryForUser(user) {
  if (!user) return null;

  const membership = await Membership.activeForUser(user._id);
  if (!membership) return null;

  const organization = await Organization.findById(membership.organizationId)
    .select('name slug type status settings ownerUserId')
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
  requireAnyCapability,
  hasCapability,
  tenantFilter,
  tenantStamp,
  projectScopeFilter,
  accountUserId,
  accountUserIdFor,
  accountUserIdForOrg,
  actorContextFor,
  userHasCapability,
};
