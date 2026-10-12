const mongoose = require('mongoose');

/**
 * Job posting for the acerstone job marketplace.
 * Filterable fields (salary, experience) are stored as numbers; the original
 * display text is kept too. Skills/responsibilities/qualifications are arrays.
 */
const jobSchema = new mongoose.Schema(
  {
    jobCode: { type: String, trim: true, index: true },
    slug: { type: String, trim: true, index: true },

    title: { type: String, required: [true, 'Job title is required'], trim: true, index: true },
    location: { type: String, trim: true, index: true },
    isRemote: { type: Boolean, default: false },

    // Experience — numeric for range filtering + original text for display
    expMin: { type: Number, index: true },
    expMax: { type: Number },
    experienceText: { type: String, trim: true },

    // Salary — same pattern
    salaryMin: { type: Number, index: true },
    salaryMax: { type: Number },
    salaryCurrency: { type: String, default: 'INR' },
    salaryPeriod: { type: String, default: 'year' }, // year | month
    salaryText: { type: String, trim: true },

    skills: { type: [String], index: true }, // Key Skills → array (multikey)
    postedBy: { type: String, trim: true }, // recruiter / company
    noticePeriod: { type: String, trim: true },

    description: { type: String },
    responsibilities: { type: [String] },
    qualifications: { type: [String] },

    employmentType: { type: String, default: 'full-time' }, // full-time | contract | part-time
    status: { type: String, enum: ['open', 'closed', 'draft'], default: 'open', index: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    applicationCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

// Keyword search across the fields a search box would target
jobSchema.index({ title: 'text', skills: 'text', description: 'text' });
// Common filter combo
jobSchema.index({ status: 1, location: 1, salaryMin: 1 });

const Job = mongoose.model('Job', jobSchema, 'jobs');

module.exports = Job;
