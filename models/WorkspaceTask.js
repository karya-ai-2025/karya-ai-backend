// models/WorkspaceTask.js
//
// The worker's own breakdown of a project's work — a simple to-do list,
// optionally under a milestone. The business can see it (read-only); the
// worker's team plans and ticks it off.

const mongoose = require('mongoose');

const STATUSES = ['todo', 'doing', 'done'];

const workspaceTaskSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    projectInstanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectUser', required: true, index: true },
    milestoneId: { type: mongoose.Schema.Types.ObjectId, ref: 'Milestone', default: null },

    title: { type: String, required: true, trim: true, maxlength: 200 },
    notes: { type: String, trim: true, maxlength: 2000, default: '' },
    status: { type: String, enum: STATUSES, default: 'todo' },
    assigneeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    dueDate: { type: Date, default: null },
    completedAt: { type: Date },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

workspaceTaskSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model('WorkspaceTask', workspaceTaskSchema);
