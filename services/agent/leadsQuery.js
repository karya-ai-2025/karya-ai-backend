/**
 * Shared lead-query helpers — turn a leadsFilter into recipients.
 *
 * The leads node has its own inline copy of this logic (working + tested);
 * this module exists so the EMAIL agent can pull recipients from the exact
 * same filter without duplicating the mapping-table resolution. A later
 * cleanup can point leadsAgentNode at this too (one source of truth).
 *
 * SAFETY: every query REQUIRES at least one real filter clause. We never
 * build a WHERE that would match the whole table (no blanket email blasts).
 */

const { prisma } = require('../../utils/prismaClient');

// ── Mapping-table resolvers (region → countries, segment → range, seniority → keywords)
const resolveRegion = async (location) => {
  if (!location) return null;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT countries FROM tbl_regions WHERE region_name = LOWER($1)`,
      location.trim()
    );
    return rows[0]?.countries || null;
  } catch { return null; }
};

const resolveSegment = async (segment) => {
  if (!segment) return null;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT min_employees, max_employees FROM tbl_segments WHERE segment_name = LOWER($1)`,
      segment.trim()
    );
    return rows[0] || null;
  } catch { return null; }
};

const resolveSeniority = async (seniority) => {
  if (!seniority) return null;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT title_keywords FROM tbl_seniority WHERE level_name = LOWER($1)`,
      seniority.trim()
    );
    return rows[0]?.title_keywords || null;
  } catch { return null; }
};

// Build the WHERE clauses + values from a filter. Returns { clauses, values }.
// `clauses` counts ONLY real filter conditions (not the email guard).
// Resolve an industry phrase → canonical industry_name (tolerant of &/and/spacing).
const resolveIndustry = async (industry) => {
  if (!industry) return null;
  const input = industry.trim();
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT industry_name FROM tbl_gtm_industry
       WHERE regexp_replace(lower(replace(industry_name, '&', 'and')), '[^a-z0-9]', '', 'g')
           = regexp_replace(lower(replace($1, '&', 'and')), '[^a-z0-9]', '', 'g')
       LIMIT 1`,
      input
    );
    return rows[0]?.industry_name || input;
  } catch { return input; }
};

const buildFilterWhere = async (filter = {}) => {
  const [industryName, regionCountries, empRange, titleKeywords] = await Promise.all([
    resolveIndustry(filter.industry),
    resolveRegion(filter.location),
    resolveSegment(filter.segment),
    resolveSeniority(filter.seniority)
  ]);

  const values = [];
  const clauses = [];

  if (filter.industry) {
    clauses.push(`"GTM Industry" ILIKE '%' || $${values.length + 1} || '%'`);
    values.push(industryName);
  }
  if (filter.company) {
    clauses.push(`"Account Name" ILIKE '%' || $${values.length + 1} || '%'`);
    values.push(filter.company.trim());
  }
  if (filter.location) {
    if (regionCountries && regionCountries.length > 0) {
      clauses.push(`LOWER("Mailing Country") = ANY($${values.length + 1}::text[])`);
      values.push(regionCountries);
    } else {
      clauses.push(`"Mailing Country" ILIKE '%' || $${values.length + 1} || '%'`);
      values.push(filter.location.trim());
    }
  }
  if (empRange) {
    if (empRange.min_employees !== null && empRange.max_employees !== null) {
      clauses.push(`employees BETWEEN $${values.length + 1} AND $${values.length + 2}`);
      values.push(empRange.min_employees, empRange.max_employees);
    } else if (empRange.min_employees !== null) {
      clauses.push(`employees >= $${values.length + 1}`);
      values.push(empRange.min_employees);
    }
  }
  if (titleKeywords && titleKeywords.length > 0) {
    clauses.push(`title ILIKE ANY($${values.length + 1}::text[])`);
    values.push(titleKeywords.map((kw) => `%${kw}%`));
  }
  if (filter.title) {
    clauses.push(`title ILIKE '%' || $${values.length + 1} || '%'`);
    values.push(filter.title.trim());
  }

  return { clauses, values };
};

const EMAIL_GUARD = `email IS NOT NULL AND email <> ''`;

// Count leads that have a valid email and match the filter.
const countEmailableLeads = async (filter = {}) => {
  const { clauses, values } = await buildFilterWhere(filter);
  if (clauses.length === 0) return 0; // never count the whole table
  const where = [...clauses, EMAIL_GUARD].join(' AND ');
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS count FROM tbl_healthcare WHERE ${where}`,
      ...values
    );
    return Number(rows[0].count);
  } catch { return 0; }
};

// Fetch actual recipients (with emails) for building a campaign.
const fetchEmailableLeads = async (filter = {}, { limit = 500, excludeIds = [] } = {}) => {
  const { clauses, values } = await buildFilterWhere(filter);
  if (clauses.length === 0) return []; // never fetch the whole table

  const selectValues = [...values, excludeIds];
  const excludeIdx = selectValues.length; // last param
  const where = [...clauses, EMAIL_GUARD, `id <> ALL($${excludeIdx}::int[])`].join(' AND ');

  try {
    return await prisma.$queryRawUnsafe(`
      SELECT id, "First Name", "Last Name", title,
             "Account Name", "Mailing Country",
             email, phone, "GTM Industry", employees
      FROM tbl_healthcare
      WHERE ${where}
      ORDER BY id
      LIMIT ${Number(limit)}
    `, ...selectValues);
  } catch { return []; }
};

module.exports = {
  buildFilterWhere,
  countEmailableLeads,
  fetchEmailableLeads
};
