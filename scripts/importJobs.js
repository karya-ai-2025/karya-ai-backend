/**
 * Import jobs from an Excel sheet into the `jobs` collection.
 *
 * Usage:
 *   node scripts/importJobs.js <path-to-file.xlsx>            # DRY RUN — parses + prints, writes nothing
 *   node scripts/importJobs.js <path-to-file.xlsx> --commit   # actually upserts into the DB
 *
 * Safe: only upserts one job per (title + location). No deletes, no bulk wipes.
 * Ignores the "S.No" and "Job Link" columns (apply is in-app, no external link).
 */
const path = require('path');
const XLSX = require('xlsx');
const { config } = require('../config/config');
const mongoose = require('mongoose');
const Job = require('../models/Job');

const FILE = process.argv[2];
const COMMIT = process.argv.includes('--commit');

if (!FILE) {
  console.error('Usage: node scripts/importJobs.js <file.xlsx> [--commit]');
  process.exit(1);
}

// ── header lookup (case/space tolerant) ──────────────────────────────────────
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const pick = (row, names) => {
  const wanted = names.map(norm);
  const key = Object.keys(row).find((k) => wanted.includes(norm(k)));
  return key ? row[key] : '';
};

// ── text → numeric parsers ───────────────────────────────────────────────────
const slugify = (s = '') => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

const parseExperience = (text = '') => {
  const s = String(text);
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (nums.length >= 2) return { expMin: nums[0], expMax: nums[1] };
  if (nums.length === 1) return /\+/.test(s) ? { expMin: nums[0] } : { expMin: nums[0], expMax: nums[0] };
  return {};
};

const parseSalary = (text = '') => {
  const s = String(text).toLowerCase();
  const nums = (s.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (nums.length === 0) return {}; // "best in industry", "negotiable", blank → text only
  let mult = 1;
  if (/lpa|lakh|lac/.test(s)) mult = 100000;
  else if (/\bcr\b|crore/.test(s)) mult = 10000000;
  else if (/\bk\b|thousand/.test(s)) mult = 1000;
  const vals = nums.map((n) => Math.round(n * mult));
  return vals.length >= 2 ? { salaryMin: vals[0], salaryMax: vals[1] } : { salaryMin: vals[0], salaryMax: vals[0] };
};

const splitSkills = (t = '') => String(t).split(/[,\n]+/).map((x) => x.trim()).filter(Boolean);
const splitBullets = (t = '') => String(t).split(/\r?\n+/).map((x) => x.replace(/^\s*[-–•*]\s*/, '').trim()).filter(Boolean);

// ── build a Job doc from a spreadsheet row ───────────────────────────────────
const rowToJob = (row) => {
  const title = String(pick(row, ['Job Title', 'Title']) || '').trim();
  if (!title) return null;

  const experienceText = String(pick(row, ['Experience', 'Experience (Years)']) || '').trim();
  const salaryText = String(pick(row, ['Salary', 'CTC']) || '').trim();

  return {
    title,
    location: String(pick(row, ['Location']) || '').trim(),
    experienceText,
    ...parseExperience(experienceText),
    salaryText,
    ...parseSalary(salaryText),
    salaryCurrency: 'INR',
    skills: splitSkills(pick(row, ['Key Skills', 'Skills'])),
    postedBy: String(pick(row, ['Posted By', 'Recruiter']) || '').trim(),
    noticePeriod: String(pick(row, ['Notice Period']) || '').trim(),
    description: String(pick(row, ['Job Description', 'Description']) || '').trim(),
    responsibilities: splitBullets(pick(row, ['Key Responsibilities', 'Responsibilities'])),
    qualifications: splitBullets(pick(row, ['Required Qualifications / Skills', 'Required Qualifications', 'Qualifications'])),
    employmentType: 'full-time',
    status: 'open'
  };
};

(async () => {
  const wb = XLSX.readFile(path.resolve(FILE));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  const jobs = rows.map(rowToJob).filter(Boolean);

  console.log(`Parsed ${jobs.length} job(s) from "${FILE}".\n`);
  // Show the first job fully so the parsing can be eyeballed
  console.log('── First parsed job ──');
  console.log(JSON.stringify(jobs[0], null, 2));
  console.log('──────────────────────\n');

  if (!COMMIT) {
    console.log('DRY RUN — nothing written. Re-run with  --commit  to import.');
    return;
  }

  await mongoose.connect(config.mongoUri);
  console.log('Connected →', mongoose.connection.name);
  let created = 0;
  let updated = 0;
  for (const j of jobs) {
    const res = await Job.updateOne(
      { title: j.title, location: j.location },     // natural key → idempotent re-imports
      { $set: { ...j, slug: slugify(j.title) } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    if (res.upsertedCount > 0) created++; else updated++;
  }
  console.log(`\nImport complete → created: ${created}, updated: ${updated}. No deletes performed.`);
  await mongoose.disconnect();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
