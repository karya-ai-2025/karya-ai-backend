// services/leadFilters.js
// One place that turns lead-search filters into a parameterised SQL WHERE.
//
// Shared by the customer's search (POST /api/leads/generate) and the admin's
// on-behalf search (services/leadSearch.js), so the two can never drift into
// returning different leads for the same filters.
//
// EVERY column name below is a hardcoded constant. Only values are ever
// parameterised, so nothing a caller sends can alter the shape of the query.
//
// The original four filters (industry, company, companySegment, location) plus
// segment/seniority keep their exact previous semantics — including the region
// and employee-band expansion via the mapping tables.

const { prisma } = require('../utils/prismaClient');

/** Columns offered as dropdowns, with their real Postgres names. */
const OPTION_COLUMNS = {
  accountSegment: 'Account Segment',
  accountSubSegment: 'Account Sub Segment',
  tShirtSize: 'T Shirt Size',
  gtmSector: 'GTM Sector',
  gtmSubIndustry: 'GTM Sub-Industry',
};

const trimmed = (v) => (typeof v === 'string' ? v.trim() : '');
const asInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) ? n : null;
};

/**
 * Build the WHERE clause for a lead search.
 *
 * @param {object} f  filter values, all optional except industry
 * @returns {{ where: string, values: any[], applied: string[] }}
 */
async function buildLeadWhere(f = {}) {
  const {
    // original
    industry, company, companySegment, location, segment, seniority,
    // additional
    accountSegment, tShirtSize, gtmSector, gtmSubIndustry,
    city, state, zip, jobTitle,
    minEmployees, maxEmployees,
    hasEmail, hasPhone,
  } = f;

  // Mapping-table lookups, in one round trip.
  const [industryRecord, regionRow, segmentRow, seniorityRow] = await Promise.all([
    trimmed(industry)
      ? prisma.tbl_gtm_industry.findFirst({
          where: { industry_name: { contains: trimmed(industry).replace(/-/g, ' '), mode: 'insensitive' } },
        })
      : Promise.resolve(null),
    trimmed(location)
      ? prisma.$queryRawUnsafe(`SELECT countries FROM tbl_regions WHERE region_name = LOWER($1)`, trimmed(location))
      : Promise.resolve([]),
    trimmed(segment)
      ? prisma.$queryRawUnsafe(
          `SELECT min_employees, max_employees FROM tbl_segments WHERE segment_name = LOWER($1)`,
          trimmed(segment)
        )
      : Promise.resolve([]),
    trimmed(seniority)
      ? prisma.$queryRawUnsafe(`SELECT title_keywords FROM tbl_seniority WHERE level_name = LOWER($1)`, trimmed(seniority))
      : Promise.resolve([]),
  ]);

  const values = [];
  const clauses = [];
  const applied = [];

  const next = () => `$${values.length + 1}`;
  const like = (col, value, label) => {
    clauses.push(`"${col}" ILIKE '%' || ${next()} || '%'`);
    values.push(value);
    applied.push(label);
  };
  const exact = (col, value, label) => {
    clauses.push(`"${col}" = ${next()}`);
    values.push(value);
    applied.push(label);
  };

  // ── Original filters, unchanged ─────────────────────────────────────────
  if (trimmed(industry)) {
    like('GTM Industry', industryRecord ? industryRecord.industry_name : trimmed(industry), 'industry');
  }
  if (trimmed(company)) like('Account Name', trimmed(company), 'company');
  if (trimmed(companySegment)) exact('Account Sub Segment', trimmed(companySegment), 'companySegment');

  if (trimmed(location)) {
    const regionCountries = regionRow[0]?.countries || null;
    if (regionCountries && regionCountries.length > 0) {
      // Region expansion: "apac" → a list of ISO-2 codes.
      clauses.push(`LOWER("Mailing Country") = ANY(${next()}::text[])`);
      values.push(regionCountries);
    } else {
      clauses.push(`"Mailing Country" ILIKE '%' || ${next()} || '%'`);
      values.push(trimmed(location));
    }
    applied.push('location');
  }

  const empRange = segmentRow[0] || null;
  if (empRange) {
    if (empRange.min_employees !== null && empRange.max_employees !== null) {
      clauses.push(`employees BETWEEN ${next()} AND $${values.length + 2}`);
      values.push(empRange.min_employees, empRange.max_employees);
    } else if (empRange.min_employees !== null) {
      clauses.push(`employees >= ${next()}`);
      values.push(empRange.min_employees);
    }
    applied.push('segment');
  }

  const titleKeywords = seniorityRow[0]?.title_keywords || null;
  if (titleKeywords && titleKeywords.length > 0) {
    clauses.push(`title ILIKE ANY(${next()}::text[])`);
    values.push(titleKeywords.map((kw) => `%${kw}%`));
    applied.push('seniority');
  }

  // ── Additional filters ──────────────────────────────────────────────────
  // Low-cardinality columns are exact matches (they come from a dropdown of
  // real values); the free-text ones are substring matches.
  if (trimmed(accountSegment)) exact('Account Segment', trimmed(accountSegment), 'accountSegment');
  if (trimmed(tShirtSize)) exact('T Shirt Size', trimmed(tShirtSize), 'tShirtSize');
  if (trimmed(gtmSector)) exact('GTM Sector', trimmed(gtmSector), 'gtmSector');
  if (trimmed(gtmSubIndustry)) exact('GTM Sub-Industry', trimmed(gtmSubIndustry), 'gtmSubIndustry');

  if (trimmed(city)) like('Mailing City', trimmed(city), 'city');
  if (trimmed(state)) like('Mailing State/Province', trimmed(state), 'state');
  if (trimmed(zip)) like('Mailing Zip/Postal Code', trimmed(zip), 'zip');
  if (trimmed(jobTitle)) like('title', trimmed(jobTitle), 'jobTitle');

  // Explicit employee range. Applied on top of the size band, not instead of
  // it, so "Mid-market AND at least 500 staff" narrows rather than replaces.
  const min = asInt(minEmployees);
  const max = asInt(maxEmployees);
  if (min !== null) {
    clauses.push(`employees >= ${next()}`);
    values.push(min);
    applied.push('minEmployees');
  }
  if (max !== null) {
    clauses.push(`employees <= ${next()}`);
    values.push(max);
    applied.push('maxEmployees');
  }

  // Contactability. No parameters — fixed predicates on constant columns.
  if (hasEmail === true || hasEmail === 'true') {
    clauses.push(`(email IS NOT NULL AND email <> '')`);
    applied.push('hasEmail');
  }
  if (hasPhone === true || hasPhone === 'true') {
    clauses.push(`((phone IS NOT NULL AND phone <> '') OR (mobile IS NOT NULL AND mobile <> ''))`);
    applied.push('hasPhone');
  }

  // A search with no filters at all would scan the whole table, so require one.
  if (!clauses.length) {
    const err = new Error('At least one filter is required');
    err.statusCode = 400;
    throw err;
  }

  return { where: clauses.join(' AND '), values, applied };
}

/**
 * Distinct values for the dropdown filters, so the UI offers only values that
 * actually exist in the data rather than a hardcoded guess.
 *
 * Cached in-process: these change only when the lead table is re-imported.
 */
let optionsCache = null;
let optionsCachedAt = 0;
const OPTIONS_TTL_MS = 10 * 60 * 1000;

async function getFilterOptions({ force = false } = {}) {
  if (!force && optionsCache && Date.now() - optionsCachedAt < OPTIONS_TTL_MS) {
    return optionsCache;
  }

  const entries = await Promise.all(
    Object.entries(OPTION_COLUMNS).map(async ([key, column]) => {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT "${column}" AS value, COUNT(*)::int AS count
           FROM tbl_healthcare
          WHERE "${column}" IS NOT NULL AND "${column}" <> ''
          GROUP BY "${column}"
          ORDER BY count DESC`
      );
      return [key, rows.map((r) => ({ value: r.value, label: r.value, count: r.count }))];
    })
  );

  // The employee range, so the UI can show real bounds rather than guessing.
  const [range] = await prisma.$queryRawUnsafe(
    `SELECT MIN(employees)::int AS min, MAX(employees)::int AS max
       FROM tbl_healthcare WHERE employees IS NOT NULL`
  );

  optionsCache = {
    ...Object.fromEntries(entries),
    employeeRange: { min: range?.min ?? 0, max: range?.max ?? 0 },
  };
  optionsCachedAt = Date.now();
  return optionsCache;
}

module.exports = { buildLeadWhere, getFilterOptions, OPTION_COLUMNS };
