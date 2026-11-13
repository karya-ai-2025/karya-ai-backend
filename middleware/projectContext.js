// middleware/projectContext.js
//
// Which purchased project (ProjectUser) a request is working in.
//
// The project workspace sends the project's id in the `X-Karya-Project`
// header on every call it makes. On the routers that hold project work —
// campaigns, templates, lead lists, ICPs, review requests — this middleware
// runs right after `protect` and:
//
//   • checks the project belongs to the caller's own company (an id from
//     another company is "not found", never "forbidden", so ids can't be probed)
//   • puts it on req.project, and how strictly to scope on req.projectScope
//
// tenantFilter / tenantStamp (middleware/orgContext.js) then add the project
// to every query and every new record, so no controller has to remember to.
//
// Scope:
//   business → 'lenient': its own project's work plus anything not yet tied
//              to a project (older records, and work the Karya team built for
//              it outside a project) — all of it is the business's own.
//   partner  → 'strict': a worker (agency / expert) gets in only through an
//              ACTIVE engagement on that project for their agency, and only
//              if they're assigned to it (or are the agency's admin / lead).
//              They then see the client's records for that one project and
//              nothing else, with the capabilities the engagement grants.
//              No header, or no such engagement → 404.
//
// No header → no project: company-wide views (e.g. the business dashboard)
// keep seeing everything the company owns. Workers have no such view.

const mongoose = require('mongoose');
const ProjectUser = require('../models/ProjectUser');
const Engagement = require('../models/Engagement');
const Organization = require('../models/Organization');
const { AppError } = require('./errorHandler');
const { accountUserId } = require('./orgContext');

const HEADER = 'x-karya-project';

const projectNotFound = () => new AppError('Project not found', 404);

async function projectContext(req, res, next) {
  try {
    req.project = null;
    req.projectScope = null;
    req.engagement = null;

    const raw = req.headers[HEADER];
    const isWorker = req.user && req.user.kind === 'partner';

    // A worker only ever works inside one client project at a time
    if (!raw) return next(isWorker ? projectNotFound() : undefined);

    const id = String(raw).trim();
    if (!mongoose.Types.ObjectId.isValid(id)) return next(projectNotFound());

    if (isWorker) return next(await workerAccess(req, id));

    if (!req.user || req.user.kind !== 'business' || !req.organizationId) {
      return next(projectNotFound());
    }

    // Projects are held by the company's owning account (see accountUserId).
    const project = await ProjectUser.findOne({ _id: id, userId: accountUserId(req) })
      .select('_id projectSlug catalogId')
      .lean();
    if (!project) return next(projectNotFound());

    req.project = { _id: project._id, slug: project.projectSlug };
    req.projectScope = 'lenient';
    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * A worker's way into a client's project: an engagement between their agency
 * and that project. Sets req.project / req.projectScope / req.engagement, or
 * returns the error to pass on. Checked on every request, so pausing or ending
 * the engagement cuts access straight away.
 */
async function workerAccess(req, projectId) {
  if (!req.organizationId || !req.membership) return projectNotFound();

  const engagement = await Engagement.findOne({
    projectInstanceId: projectId,
    partnerOrgId: req.organizationId,
    status: { $in: ['active', 'paused'] },
  }).lean();
  if (!engagement) return projectNotFound();

  const leadsTheAgency = ['admin', 'manager'].includes(req.membership.role);
  const assigned = (engagement.members || []).some((m) => String(m.userId) === String(req.user._id));
  if (!leadsTheAgency && !assigned) return projectNotFound();

  if (engagement.status === 'paused') {
    return new AppError('The client has paused your access to this project.', 403);
  }

  const [project, business] = await Promise.all([
    ProjectUser.findById(projectId).select('_id projectSlug').lean(),
    Organization.findById(engagement.businessOrgId).select('ownerUserId status').lean(),
  ]);
  if (!project || !business || business.status !== 'active') return projectNotFound();

  req.project = { _id: project._id, slug: project.projectSlug };
  req.projectScope = 'strict';
  req.engagement = {
    _id: engagement._id,
    businessOrgId: engagement.businessOrgId,
    businessOwnerUserId: business.ownerUserId,
    // Everyone working on a project sees and keeps its plan (milestones and
    // tasks) — that's the job, not an option; the rest is what the client granted
    grants: [...new Set([...(engagement.grants || []), 'plan.view', 'plan.edit'])],
  };
  return undefined;
}

module.exports = { projectContext, PROJECT_HEADER: HEADER };
