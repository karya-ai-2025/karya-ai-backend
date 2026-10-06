const multer = require('multer');
const Job = require('../models/Job');
const JobApplication = require('../models/JobApplication');
const User = require('../models/User');
const { uploadAttachmentBuffer, downloadAttachmentBuffer } = require('../services/blobStorageService');
const { rowToJob } = require('../utils/jobImport');

// ── Resume upload (memory → Azure Blob) ─────────────────────────────────────
const RESUME_MAX_MB = parseInt(process.env.RESUME_MAX_FILE_SIZE_MB, 10) || 5;
const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: RESUME_MAX_MB * 1024 * 1024, files: 1 }
});

const isPdf = (file) =>
  file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '');

// POST /api/jobs/resume  (auth) — upload a resume PDF, returns a blob reference
const uploadResume = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'A resume file is required' });
    }
    if (!isPdf(req.file)) {
      return res.status(400).json({ success: false, message: 'Resume must be a PDF' });
    }

    const meta = await uploadAttachmentBuffer({ userId, file: req.file });

    res.json({
      success: true,
      data: { resumeBlobName: meta.blobName, resumeFileName: meta.fileName, uploadedAt: meta.uploadedAt },
      message: 'Resume uploaded'
    });
  } catch (error) {
    console.error('Error uploading resume:', error);
    res.status(500).json({ success: false, message: 'Failed to upload resume', error: error.message });
  }
};

// ── Job listing + filtering ─────────────────────────────────────────────────
// GET /api/jobs?search=&location=&skills=a,b&expMax=&salaryMin=&page=&limit=
const listJobs = async (req, res) => {
  try {
    const { search, location, skills, expMax, salaryMin, employmentType, remote, page = 1, limit = 20 } = req.query;
    const filter = { status: 'open' };

    if (location) filter.location = { $regex: location, $options: 'i' };
    if (employmentType) filter.employmentType = employmentType;
    if (remote === 'true') filter.isRemote = true;
    if (skills) {
      const list = String(skills).split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length) filter.skills = { $in: list.map((s) => new RegExp(s, 'i')) };
    }
    // "I have N years" → jobs whose minimum requirement is <= N
    if (expMax !== undefined && expMax !== '') filter.expMin = { $lte: Number(expMax) };
    // "at least X salary" → jobs whose max offered is >= X
    if (salaryMin !== undefined && salaryMin !== '') filter.salaryMax = { $gte: Number(salaryMin) };
    if (search) filter.$text = { $search: search };

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const perPage = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));

    const [jobs, total] = await Promise.all([
      Job.find(filter)
        .select('title location isRemote experienceText salaryText skills postedBy employmentType noticePeriod slug createdAt')
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * perPage)
        .limit(perPage)
        .lean(),
      Job.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: { jobs, pagination: { currentPage: pageNum, totalPages: Math.ceil(total / perPage) || 1, totalCount: total } }
    });
  } catch (error) {
    console.error('Error listing jobs:', error);
    res.status(500).json({ success: false, message: 'Failed to load jobs', error: error.message });
  }
};

// GET /api/jobs/:idOrSlug — full job detail
const getJob = async (req, res) => {
  try {
    const key = req.params.idOrSlug;
    const query = key.match(/^[0-9a-fA-F]{24}$/) ? { _id: key } : { slug: key };
    const job = await Job.findOne(query).lean();
    if (!job || job.status === 'draft') {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    // If the user is logged in, tell them whether they already applied.
    let hasApplied = false;
    if (req.user) {
      hasApplied = !!(await JobApplication.exists({ jobId: job._id, userId: req.user.id || req.user._id }));
    }

    res.json({ success: true, data: { job, hasApplied } });
  } catch (error) {
    console.error('Error fetching job:', error);
    res.status(500).json({ success: false, message: 'Failed to load job', error: error.message });
  }
};

// POST /api/jobs/:id/apply  (auth) — apply to a job with the applicant's details
const applyToJob = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const job = await Job.findById(req.params.id);
    if (!job || job.status !== 'open') {
      return res.status(404).json({ success: false, message: 'Job not found or no longer open' });
    }

    const already = await JobApplication.findOne({ jobId: job._id, userId });
    if (already) {
      return res.status(409).json({ success: false, message: 'You have already applied to this job' });
    }

    const b = req.body || {};
    const user = await User.findById(userId).select('fullName email').lean();

    const application = await JobApplication.create({
      jobId: job._id,
      userId,
      fullName: b.fullName || user?.fullName || '',
      email: (b.email || user?.email || '').toLowerCase(),
      phone: b.phone || '',
      location: b.location || '',
      yearsExperience: b.yearsExperience != null ? Number(b.yearsExperience) : undefined,
      skills: Array.isArray(b.skills) ? b.skills : String(b.skills || '').split(',').map((s) => s.trim()).filter(Boolean),
      linkedinUrl: b.linkedinUrl || '',
      coverNote: b.coverNote || '',
      resumeBlobName: b.resumeBlobName || '',
      resumeFileName: b.resumeFileName || ''
    });

    await Job.findByIdAndUpdate(job._id, { $inc: { applicationCount: 1 } });

    res.status(201).json({ success: true, data: { applicationId: application._id }, message: 'Application submitted' });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'You have already applied to this job' });
    }
    console.error('Error applying to job:', error);
    res.status(500).json({ success: false, message: 'Failed to submit application', error: error.message });
  }
};

// GET /api/jobs/my/applications  (auth) — the current user's applications
const myApplications = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const applications = await JobApplication.find({ userId })
      .populate('jobId', 'title location employmentType slug')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: { applications } });
  } catch (error) {
    console.error('Error fetching applications:', error);
    res.status(500).json({ success: false, message: 'Failed to load applications', error: error.message });
  }
};

// GET /api/jobs/applications/:id/resume  (auth) — stream a resume (applicant only)
const downloadResume = async (req, res) => {
  try {
    const userId = String(req.user.id || req.user._id);
    const app = await JobApplication.findById(req.params.id).lean();
    if (!app || !app.resumeBlobName) {
      return res.status(404).json({ success: false, message: 'Resume not found' });
    }
    // Only the applicant (or an admin) may download.
    if (String(app.userId) !== userId && !req.user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this resume' });
    }
    const buffer = await downloadAttachmentBuffer(app.resumeBlobName);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${app.resumeFileName || 'resume.pdf'}"`);
    res.send(buffer);
  } catch (error) {
    console.error('Error downloading resume:', error);
    res.status(500).json({ success: false, message: 'Failed to load resume', error: error.message });
  }
};

// POST /api/jobs  (auth) — create a job posting (internal/admin use)
const slugify = (s = '') => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

const createJob = async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.title) return res.status(400).json({ success: false, message: 'Job title is required' });

    const job = await Job.create({
      ...b,
      slug: b.slug ? slugify(b.slug) : `${slugify(b.title)}-${Date.now().toString(36)}`,
      createdBy: req.user.id || req.user._id
    });
    res.status(201).json({ success: true, data: { job }, message: 'Job created' });
  } catch (error) {
    console.error('Error creating job:', error);
    res.status(500).json({ success: false, message: 'Failed to create job', error: error.message });
  }
};

// POST /api/jobs/import  (admin) — bulk-create jobs from parsed spreadsheet rows.
// The frontend reads the Excel in the browser and sends { rows: [...] }; parsing
// (experience/salary → numbers, arrays, slugs) happens here via the shared util.
// Idempotent: upserts by (title + location). No deletes.
const importJobs = async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No rows to import' });
    }

    const jobs = rows.map(rowToJob).filter(Boolean);
    let created = 0;
    let updated = 0;
    for (const j of jobs) {
      const result = await Job.updateOne(
        { title: j.title, location: j.location },
        { $set: { ...j, createdBy: req.user.id || req.user._id } },
        { upsert: true, setDefaultsOnInsert: true }
      );
      if (result.upsertedCount > 0) created += 1;
      else updated += 1;
    }

    res.json({
      success: true,
      data: { totalRows: rows.length, imported: jobs.length, created, updated, skipped: rows.length - jobs.length },
      message: `Imported ${jobs.length} job(s) — ${created} new, ${updated} updated`
    });
  } catch (error) {
    console.error('Error importing jobs:', error);
    res.status(500).json({ success: false, message: 'Failed to import jobs', error: error.message });
  }
};

module.exports = {
  resumeUpload,
  uploadResume,
  listJobs,
  getJob,
  applyToJob,
  myApplications,
  downloadResume,
  createJob,
  importJobs
};
