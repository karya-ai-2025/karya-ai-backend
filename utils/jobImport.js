/**
 * Shared spreadsheet → Job mapping/parsing. Used by both the import API endpoint
 * and the CLI import script, so the logic lives in exactly one place.
 */
const slugify = (s = '') =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

// Case/space/punctuation-tolerant header lookup
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const pick = (row, names) => {
  const wanted = names.map(norm);
  const key = Object.keys(row || {}).find((k) => wanted.includes(norm(k)));
  return key ? row[key] : '';
};

// "4 - 8 yrs" → {expMin:4, expMax:8}; "5+ years" → {expMin:5}; "3 years" → {expMin:3, expMax:3}
const parseExperience = (text = '') => {
  const s = String(text);
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (nums.length >= 2) return { expMin: nums[0], expMax: nums[1] };
  if (nums.length === 1) return /\+/.test(s) ? { expMin: nums[0] } : { expMin: nums[0], expMax: nums[0] };
  return {};
};

// "8-12 LPA" → {salaryMin:800000, salaryMax:1200000}; "Best in industry" → {} (text only)
const parseSalary = (text = '') => {
  const s = String(text).toLowerCase();
  const nums = (s.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (nums.length === 0) return {};
  let mult = 1;
  if (/lpa|lakh|lac/.test(s)) mult = 100000;
  else if (/\bcr\b|crore/.test(s)) mult = 10000000;
  else if (/\bk\b|thousand/.test(s)) mult = 1000;
  const vals = nums.map((n) => Math.round(n * mult));
  return vals.length >= 2 ? { salaryMin: vals[0], salaryMax: vals[1] } : { salaryMin: vals[0], salaryMax: vals[0] };
};

const splitSkills = (t = '') => String(t).split(/[,\n]+/).map((x) => x.trim()).filter(Boolean);
const splitBullets = (t = '') => String(t).split(/\r?\n+/).map((x) => x.replace(/^\s*[-–•*]\s*/, '').trim()).filter(Boolean);

// Turn one spreadsheet row into a Job doc (or null if it has no title).
const rowToJob = (row) => {
  const title = String(pick(row, ['Job Title', 'Title']) || '').trim();
  if (!title) return null;

  const experienceText = String(pick(row, ['Experience', 'Experience (Years)']) || '').trim();
  const salaryText = String(pick(row, ['Salary', 'CTC']) || '').trim();

  return {
    title,
    slug: slugify(title),
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
    // "S.No" and "Job Link" columns are intentionally ignored.
  };
};

module.exports = { rowToJob, slugify };
