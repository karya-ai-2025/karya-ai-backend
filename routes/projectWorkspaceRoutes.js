// routes/projectWorkspaceRoutes.js
//
// /api/projects/:projectId/* — the project workspace the business and its
// workers share. Mounted behind kindGate('business', 'partner').
//
// The project comes from the URL and goes through the same projectContext
// check as every other project call: a business gets its own project, a
// worker only one it has an active engagement on. Anything else is 404.

const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { projectContext } = require('../middleware/projectContext');
const { AppError } = require('../middleware/errorHandler');
const ctrl = require('../controllers/projectWorkspaceController');
const approvalsCtrl = require('../controllers/approvalController');

const router = express.Router({ mergeParams: true });

// The project named in the path is the project for this request
const projectFromPath = (req, res, next) => {
  req.headers['x-karya-project'] = String(req.params.projectId || '');
  next();
};
const requireProject = (req, res, next) => (req.project ? next() : next(new AppError('Project not found', 404)));

router.use(protect, projectFromPath, projectContext, requireProject);

router.get('/workspace', ctrl.getWorkspace);

router.get('/milestones', ctrl.listMilestones);
router.post('/milestones', ctrl.createMilestone);
router.patch('/milestones/:milestoneId', ctrl.updateMilestone);

router.get('/tasks', ctrl.listTasks);
router.post('/tasks', ctrl.createTask);
router.patch('/tasks/:taskId', ctrl.updateTask);
router.delete('/tasks/:taskId', ctrl.deleteTask);

// The project's approval requests (services/approvals.js)
router.get('/approvals', approvalsCtrl.listProjectApprovals);
router.post('/approvals', approvalsCtrl.createProjectApproval);
router.get('/activity', ctrl.listActivity);

module.exports = router;
