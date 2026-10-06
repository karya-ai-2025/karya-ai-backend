// services/leadSearch.js
// Lead search against the Postgres lead database, for the admin
// "build a campaign for a customer" flow.
//
// The filter semantics live in services/leadFilters.js, shared with the
// customer's own search so the two can never disagree. What this adds is the
// part that is specific to acting on someone else's behalf: the exclusion set
// must be the CUSTOMER'S delivered leads, not the admin's.
//
// The customer-facing route is deliberately left otherwise untouched.

const { prisma } = require('../utils/prismaClient');
const UserCRM = require('../models/UserCRM');
const { buildLeadWhere } = require('./leadFilters');

/**
 * Leads already delivered to this user, so a second campaign does not
 * re-contact the same people.
 */
async function deliveredLeadIds(userId) {
  const crmDocs = await UserCRM.find({ userId }, { leadIds: 1, _id: 0 }).lean();
  return [
    ...new Set(
      crmDocs
        .flatMap((doc) => doc.leadIds || [])
        .map((id) => parseInt(id, 10))
        .filter((n) => Number.isInteger(n) && n > 0)
    ),
  ];
}

/**
 * Search the lead database on behalf of a specific user.
 *
 * @param {object}  opts
 * @param {string}  opts.userId  whose delivered-leads are excluded
 * @param {number} [opts.cursor] keyset pagination
 * @param {number} [opts.limit]  1–100
 * @param {...}                  every filter accepted by buildLeadWhere
 */
async function searchLeads({ userId, cursor = 0, limit = 100, ...filters }) {
  const safeCursor = Number.isInteger(Number(cursor)) ? Number(cursor) : 0;
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 100);

  const [{ where, values, applied }, excludeIds] = await Promise.all([
    buildLeadWhere(filters),
    deliveredLeadIds(userId),
  ]);

  const countResult = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS count FROM tbl_healthcare WHERE ${where}`,
    ...values
  );
  const totalMatched = Number(countResult[0].count);

  const selectValues = [...values];
  const cursorIdx = selectValues.length + 1; selectValues.push(safeCursor);
  const excludeIdx = selectValues.length + 1; selectValues.push(excludeIds);
  const limitIdx = selectValues.length + 1; selectValues.push(safeLimit);

  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT
        id, salutation,
        "First Name", "Last Name", title,
        "Account Name",
        "Mailing City", "Mailing State/Province", "Mailing Zip/Postal Code",
        "Mailing Country",
        phone, mobile, email,
        "GTM Industry", "GTM Sector", "GTM Sub-Industry",
        employees, "T Shirt Size", "Account Segment", "Account Sub Segment"
      FROM tbl_healthcare
      WHERE ${where}
        AND id > $${cursorIdx}
        AND id <> ALL($${excludeIdx}::int[])
      ORDER BY id
      LIMIT $${limitIdx}
    `,
    ...selectValues
  );

  // Normalised to the shape Campaign.selectedLeads expects, so the UI never
  // has to know the Postgres column names. The extra attributes ride along so
  // a filtered-on field can also be shown.
  const leads = rows.map((r) => ({
    leadId: String(r.id),
    email: (r.email || '').trim().toLowerCase(),
    firstName: r['First Name'] || '',
    lastName: r['Last Name'] || '',
    company: r['Account Name'] || '',
    jobTitle: r.title || '',
    industry: r['GTM Industry'] || '',
    location: [r['Mailing City'], r['Mailing Country']].filter(Boolean).join(', '),
    phoneNumber: r.mobile || r.phone || '',
    // Extra detail — filterable, and available to show in the results table.
    gtmSector: r['GTM Sector'] || '',
    gtmSubIndustry: r['GTM Sub-Industry'] || '',
    accountSegment: r['Account Segment'] || '',
    accountSubSegment: r['Account Sub Segment'] || '',
    tShirtSize: r['T Shirt Size'] || '',
    employees: r.employees ?? null,
    city: r['Mailing City'] || '',
    state: r['Mailing State/Province'] || '',
    zip: r['Mailing Zip/Postal Code'] || '',
    country: r['Mailing Country'] || '',
  }));

  return {
    leads,
    totalMatched,
    excludedCount: excludeIds.length,
    appliedFilters: applied,
    nextCursor: rows.length === safeLimit ? Number(rows[rows.length - 1].id) : null,
    hasMore: rows.length === safeLimit,
  };
}

module.exports = { searchLeads, deliveredLeadIds };
