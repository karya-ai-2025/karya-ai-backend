const mongoose = require('mongoose');

/**
 * A job application. Every applicant is a logged-in expert (the apply flow reuses
 * the existing expert auth), so `userId` is required. Applicant details are stored
 * as a snapshot of what they applied with; the resume lives in Azure Blob and is
 * referenced by `resumeBlobName` (served back through the backend).
 */
const jobApplicationSchema = new mongoose.Schema(
  {
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Applicant snapshot (also seeds / mirrors the expert profile)
    fullName: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true, index: true },
    phone: { type: String, trim: true },
    location: { type: String, trim: true },
    yearsExperience: { type: Number },
    skills: { type: [String] },
    linkedinUrl: { type: String, trim: true },
    coverNote: { type: String, trim: true, maxlength: 2000 },

    // Resume (Azure Blob)
    resumeBlobName: { type: String, trim: true },
    resumeFileName: { type: String, trim: true },

    status: {
      type: String,
      enum: ['applied', 'reviewing', 'shortlisted', 'rejected', 'hired'],
      default: 'applied',
      index: true
    },
    source: { type: String, default: 'acerstone' }
  },
  { timestamps: true }
);

// One application per user per job.
jobApplicationSchema.index({ jobId: 1, userId: 1 }, { unique: true });

const JobApplication = mongoose.model('JobApplication', jobApplicationSchema, 'jobApplications');

module.exports = JobApplication;
