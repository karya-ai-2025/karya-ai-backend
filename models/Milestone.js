// models/Milestone.js
//
// One step of a project's plan. Milestones (and tasks) are the agency's /
// expert's own planning tools for their team: they create them, set dates and
// move them along — not_started → in_progress → done — with no approval from
// the client. The client only follows the progress (on its project
// dashboard).
//
// A project's milestones start as a copy of its catalog entry's milestones the
// first time the timeline is opened, so every project begins with a plan.

const mongoose = require('mongoose');

const STATUSES = ['not_started', 'in_progress', 'done'];

const milestoneSchema = new mongoose.Schema(
  {
    // Whose project (the business's organization and purchased project)
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    projectInstanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectUser', required: true, index: true },

    order: { type: Number, default: 0 },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    dueDate: { type: Date, default: null },
    // How much of the project this milestone is, for the progress figure
    weight: { type: Number, default: 1, min: 0, max: 100 },

    status: { type: String, enum: STATUSES, default: 'not_started' },
    deliverables: [{
      name: { type: String, trim: true, maxlength: 200 },
      link: { type: String, trim: true, maxlength: 500 },
      done: { type: Boolean, default: false },
    }],

    completedAt: { type: Date },

    fromCatalog: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

milestoneSchema.index({ projectInstanceId: 1, order: 1 });
milestoneSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model('Milestone', milestoneSchema);
