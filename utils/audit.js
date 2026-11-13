// utils/audit.js
//
// Record an AuditEvent. A failed write is logged and swallowed: the action the
// person took has already happened, and losing a log line must not turn it
// into an error for them.

const AuditEvent = require('../models/AuditEvent');

/**
 * @param {object} req      the request (actor + organization are read from it), or null for jobs
 * @param {string} action   dotted verb, e.g. 'member.invited'
 * @param {object} [opts]
 * @param {object} [opts.target]       { type, id }
 * @param {string} [opts.summary]      one human-readable line
 * @param {object} [opts.details]      small extra detail
 * @param {string} [opts.tenantOrgId]  whose data — defaults to the actor's own organization
 * @param {string} [opts.via]          defaults to 'owner' with a request, 'system' without
 * @param {object} [opts.actor]        { userId, orgId } when there is no request (e.g. signup)
 * @param {string} [opts.projectInstanceId]  the project it happened in — defaults to the request's
 */
async function audit(req, action, opts = {}) {
  try {
    const actorUserId = opts.actor?.userId || req?.user?._id || null;
    const actorOrgId = opts.actor?.orgId || req?.organizationId || null;
    // Inside a client's project, a worker's actions belong on the client's log
    const tenantOrgId = opts.tenantOrgId || req?.engagement?.businessOrgId || actorOrgId;
    await AuditEvent.create({
      actorUserId,
      actorOrgId,
      via: opts.via || (req?.engagement ? 'partner' : actorUserId ? 'owner' : 'system'),
      tenantOrgId,
      projectInstanceId: opts.projectInstanceId || req?.project?._id || null,
      action,
      target: opts.target,
      summary: opts.summary,
      details: opts.details,
      ip: req?.ip,
    });
  } catch (error) {
    console.error(`Audit write failed for ${action}:`, error.message);
  }
}

module.exports = { audit };
