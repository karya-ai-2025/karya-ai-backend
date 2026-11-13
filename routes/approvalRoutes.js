// routes/approvalRoutes.js
//
// /api/approvals/:approvalId/* — one approval request: read it, decide it
// (business), comment on it (either side), withdraw it (the side that asked).
// Mounted behind kindGate('business', 'partner').
//
// Access follows the request's project through projectContext: a business
// reaches its own requests; a worker only those in a project it has an
// active engagement on.

const express = require('express');
const mongoose = require('mongoose');
const ApprovalRequest = require('../models/ApprovalRequest');
const { protect } = require('../middleware/authMiddleware');
const { projectContext } = require('../middleware/projectContext');
const { AppError } = require('../middleware/errorHandler');
const ctrl = require('../controllers/approvalController');

const router = express.Router({ mergeParams: true });
const notFound = () => new AppError('Not found', 404);

// Find the request and take its project as the project for this request
async function loadApproval(req, res, next) {
  try {
    const id = req.params.approvalId;
    if (!mongoose.Types.ObjectId.isValid(String(id))) return next(notFound());
    const approval = await ApprovalRequest.findById(id).select('organizationId projectInstanceId').lean();
    if (!approval) return next(notFound());
    req.approval = approval;
    if (approval.projectInstanceId) req.headers['x-karya-project'] = String(approval.projectInstanceId);
    else delete req.headers['x-karya-project'];
    return next();
  } catch (error) {
    return next(error);
  }
}

// After projectContext: is this caller really on the request's side of things?
function checkAccess(req, res, next) {
  const a = req.approval;
  if (req.engagement) {
    // A worker: only inside the engagement's project
    if (!a.projectInstanceId || String(req.project._id) !== String(a.projectInstanceId)) return next(notFound());
    return next();
  }
  // The business: its own requests
  if (String(a.organizationId) !== String(req.organizationId)) return next(notFound());
  return next();
}

router.use(protect, loadApproval, projectContext, checkAccess);

router.get('/', ctrl.getApproval);
router.post('/decision', ctrl.decideApproval);
router.post('/comments', ctrl.commentApproval);
router.post('/cancel', ctrl.cancelApproval);

module.exports = router;
