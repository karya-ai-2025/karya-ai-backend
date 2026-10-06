// middleware/orgContext.js
//
// Works out which organization the caller is acting in, and whether they are
// actually a member of it.
//
// This is the boundary that keeps one company's data away from another's.
// The org id arrives from the browser, so it is a claim, not a fact — it is
// only believed after a matching active Membership is found. Nothing
// downstream should ever read an org id straight off the request.
//
// Runs after `protect`, which puts the authenticated user on req.user.

const mongoose = require('mongoose');
const Membership = require('../models/Membership');
const Organization = require('../models/Organization');
const User = require('../models/User');
const { AppError } = require('./errorHandler');
const { can, capabilitiesFor, visibilityFor } = require('../config/permissions');
const { ORG_SCOPING } = require('../config/testingFlags');

const HEADER = 'x-organization-id';

/** The org the caller is asking to act in, if they named one. */
function requestedOrgId(req) {
  const raw =
    req.headers[HEADER] ||
    req.query.organizationId ||
    (req.body && req.body.organizationId) ||
    null;
  return raw && mongoose.Types.ObjectId.isValid(String(raw)) ? String(raw) : null;
}

/**
 * Resolve org context onto the request.
 *
 * Sets req.organizationId, req.membership and req.orgCapabilities when the
 * caller is a member. Does NOT reject on its own — `requireOrg` does that —
 * so routes that work with or without an org can use this alone.
 */
const attachOrgContext = async (req, res, next) => {
  try {
    if (!req.user) return next();

    const userId = req.user._id || req.user.id;
    const asked = requestedOrgId(req);

    // Named an org → must be a member of that one. No falling back to another
    // org on a miss: silently serving different data than was asked for is
    // how the wrong company's records end up on screen.
    let membership = null;
    if (asked) {
      membership = await Membership.forUserInOrg(userId, asked);
      if (!membership || !membership.isCurrentlyActive()) {
        return next(new AppError('You are not a member of this organization', 403));
      }
    } else {
      // Nothing named → their last active org, else their first.
      const user = req.user.lastActiveOrgId
        ? req.user
        : await User.findById(userId).select('lastActiveOrgId').lean();

      if (user && user.lastActiveOrgId) {
        membership = await Membership.forUserInOrg(userId, user.lastActiveOrgId);
      }
      if (!membership || !membership.isCurrentlyActive()) {
        const all = await Membership.forUser(userId);
        membership = all.find((m) => m.isCurrentlyActive()) || null;
      }
    }

    if (!membership) return next();

    req.membership = membership;
    req.organizationId = String(membership.organizationId._id || membership.organizationId);
    req.orgCapabilities = capabilitiesFor(membership);
    req.orgVisibility = visibilityFor(membership);

    return next();
  } catch (err) {
    return next(err);
  }
};

/** Require that org context resolved — use on anything org-scoped. */
const requireOrg = (req, res, next) => {
  if (!req.membership || !req.organizationId) {
    return next(new AppError(
      'No organization selected. Pass one in the X-Organization-Id header.',
      400
    ));
  }
  return next();
};

/**
 * Require a capability within the current org.
 *
 *     router.post('/:id/start', requireOrg, requireCapability('campaign.start'), start)
 *
 * A platform admin is not a member of the org, so they do not pass this —
 * admin routes live under /api/admin and use restrictTo('admin') instead.
 * Keeping the two separate is deliberate: staff access should be visible as
 * staff access, not disguised as membership.
 */
const requireCapability = (capability) => (req, res, next) => {
  if (!req.membership) {
    return next(new AppError('No organization selected', 400));
  }
  if (!can(req.membership, capability)) {
    return next(new AppError(
      `Your role (${req.membership.role}) does not allow this action`,
      403
    ));
  }
  return next();
};

/**
 * The filter every org-scoped query should start from.
 *
 * Always pins organizationId, then narrows further by what this member may
 * see. Built here rather than hand-written per controller, because the
 * dangerous bug in a multi-tenant system is the one query that forgets the
 * org — and thirty hand-written filters is thirty chances to forget.
 *
 * @param {object} req
 * @param {string} [ownerField]  field holding the creating user, for 'own' scope
 */
function orgScope(req, ownerField = 'userId') {
  if (!req.organizationId) {
    throw new AppError('orgScope called without organization context', 500);
  }

  const filter = { organizationId: req.organizationId };
  const vis = req.orgVisibility || { mode: 'own' };

  if (vis.mode === 'all') return filter;

  if (vis.mode === 'campaigns') {
    // A contractor sees only the campaigns they were hired onto. An empty
    // list means nothing, not everything.
    //
    // Carried under $and rather than as a plain `_id`, because callers
    // routinely write `{ _id: req.params.id, ...tenantFilter(req) }` — a
    // bare `_id` here would overwrite theirs and hand back some other
    // campaign the contractor happens to be assigned to. Under $and both
    // constraints must hold.
    filter.$and = [{ _id: { $in: vis.campaignIds || [] } }];
    return filter;
  }

  // 'own' and, until teams exist, 'team'
  filter[ownerField] = req.user._id || req.user.id;
  return filter;
}

/**
 * The filter a controller should actually use. This is the one to reach for.
 *
 * While ORG_SCOPING is off it returns today's exact filter — `{ userId }` —
 * so behaviour is unchanged and existing records stay visible. Once the
 * migration has stamped every record and the flag is on, it returns the
 * org-scoped filter instead.
 *
 * Having both behind one function means the switch happens in one place
 * rather than in thirty controllers, and there is no window where half the
 * app is scoped and half is not.
 *
 * @param {object} req
 * @param {string} [ownerField]  field naming the creating user
 */
function tenantFilter(req, ownerField = 'userId') {
  const userId = req.user && (req.user._id || req.user.id);

  if (!ORG_SCOPING) {
    return { [ownerField]: userId };
  }

  // Scoping is on but this caller has no org — return a filter that matches
  // nothing rather than falling back to everything.
  if (!req.organizationId) {
    return { _id: null };
  }

  return orgScope(req, ownerField);
}

/**
 * What to stamp onto a NEW record.
 *
 * Applied whether or not scoping is on, so anything created from now on is
 * already correct and the migration has less to do. userId keeps its own
 * meaning — who created this — and is set by the caller as before.
 */
function tenantStamp(req) {
  return req.organizationId ? { organizationId: req.organizationId } : {};
}

module.exports = {
  attachOrgContext,
  requireOrg,
  requireCapability,
  orgScope,
  tenantFilter,
  tenantStamp,
  HEADER,
};
