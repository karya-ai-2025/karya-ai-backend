const multer = require('multer');
const XLSX   = require('xlsx');
const { prisma } = require('../utils/prismaClient');

// memoryStorage — no temp files written to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

// ─── Hardcoded column schema — NEVER derived from the uploaded file ───────────
// norm  : lowercase-trimmed Excel header used for matching
// sql   : exact SQL column name (double-quoted where required)
// req   : row is invalid if this column is empty
// isInt : value must be coerced to integer (only `employees`)
const COLS = [
  { norm: 'salutation',              sql: 'salutation',                  req: false, isInt: false },
  { norm: 'first name',              sql: '"First Name"',                req: true,  isInt: false },
  { norm: 'last name',               sql: '"Last Name"',                 req: false, isInt: false },
  { norm: 'title',                   sql: 'title',                       req: false, isInt: false },
  { norm: 'account name',            sql: '"Account Name"',              req: false, isInt: false },
  { norm: 'mailing street',          sql: '"Mailing Street"',            req: false, isInt: false },
  { norm: 'mailing city',            sql: '"Mailing City"',              req: false, isInt: false },
  { norm: 'mailing state/province',  sql: '"Mailing State/Province"',   req: false, isInt: false },
  { norm: 'mailing zip/postal code', sql: '"Mailing Zip/Postal Code"',  req: false, isInt: false },
  { norm: 'mailing country',         sql: '"Mailing Country"',           req: true,  isInt: false },
  { norm: 'phone',                   sql: 'phone',                       req: true,  isInt: false },
  { norm: 'fax',                     sql: 'fax',                         req: false, isInt: false },
  { norm: 'mobile',                  sql: 'mobile',                      req: false, isInt: false },
  { norm: 'email',                   sql: 'email',                       req: true,  isInt: false },
  { norm: 'gtm industry',            sql: '"GTM Industry"',              req: true,  isInt: false },
  { norm: 'gtm sector',              sql: '"GTM Sector"',                req: false, isInt: false },
  { norm: 'gtm sub-industry',        sql: '"GTM Sub-Industry"',          req: false, isInt: false },
  { norm: 'employees',               sql: 'employees',                   req: false, isInt: true  },
  { norm: 't shirt size',            sql: '"T Shirt Size"',              req: false, isInt: false },
  { norm: 'account segment',         sql: '"Account Segment"',           req: false, isInt: false },
  { norm: 'account sub segment',     sql: '"Account Sub Segment"',       req: false, isInt: false },
];

const REQUIRED_NORMS = COLS.filter(c => c.req).map(c => c.norm);
const NUM_COLS       = COLS.length;
const BATCH_SIZE     = 500; // keeps param count well under Postgres 65,535 limit

// Static SQL strings built once at startup — never constructed from user input
const COL_SQL_LIST  = COLS.map(c => c.sql).join(', ');
const TEMP_COL_DEFS = COLS.map(c => `${c.sql} ${c.isInt ? 'integer' : 'text'}`).join(', ');
const EMAIL_IDX     = COLS.findIndex(c => c.norm === 'email');
const EMP_IDX       = COLS.findIndex(c => c.norm === 'employees');

// ─── Handler ─────────────────────────────────────────────────────────────────
const importLeads = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded. Use multipart field "file".' });
  }

  // ── 1. Parse the file (SheetJS auto-detects .xlsx / .xls / .csv) ─────────────
  let rows;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
      header: 1,
      defval: '',
    });
  } catch (e) {
    return res.status(400).json({ success: false, message: 'Could not parse the file (expected .xlsx, .xls, or .csv): ' + e.message });
  }

  if (rows.length < 2) {
    return res.status(400).json({ success: false, message: 'File is empty or has no data rows.' });
  }

  // ── 2. Match file headers to schema (case-insensitive, trimmed) ─────────────
  const fileHeaders = rows[0].map(h => String(h).trim().toLowerCase());

  // Reject the whole file if any required column is missing entirely
  const missingReq = REQUIRED_NORMS.filter(n => !fileHeaders.includes(n));
  if (missingReq.length) {
    return res.status(400).json({
      success: false,
      message: `Required column(s) missing from file: ${missingReq.join(', ')}`,
    });
  }

  // Map each schema column to its index in the file's header row (-1 = absent)
  const colFileIdx = COLS.map(col => fileHeaders.indexOf(col.norm));

  // ── 3. Validate every data row ──────────────────────────────────────────────
  const validRows   = [];
  const skippedRows = [];
  let totalRows = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    // Silently skip fully-blank rows (don't count them)
    if (row.every(cell => !String(cell).trim())) continue;
    totalRows++;

    const excelRowNum = i + 1; // header = row 1, first data row = row 2

    // Extract one value per schema column; absent columns → null
    const vals = COLS.map((col, ci) => {
      const fi = colFileIdx[ci];
      if (fi === -1) return null;
      const raw = fi < row.length ? String(row[fi]).trim() : '';
      return raw || null;
    });

    // Required fields
    const missingFields = COLS
      .filter((col, ci) => col.req && !vals[ci])
      .map(col => col.norm);
    if (missingFields.length) {
      skippedRows.push({ row: excelRowNum, reason: `Missing required field(s): ${missingFields.join(', ')}` });
      continue;
    }

    // Email must contain "@"
    if (!vals[EMAIL_IDX].includes('@')) {
      skippedRows.push({ row: excelRowNum, reason: 'Invalid email: missing "@"' });
      continue;
    }

    // employees must be empty OR a whole non-negative integer
    if (vals[EMP_IDX] !== null) {
      const n = Number(vals[EMP_IDX]);
      if (!Number.isInteger(n) || n < 0) {
        skippedRows.push({ row: excelRowNum, reason: `employees "${vals[EMP_IDX]}" is not a whole non-negative integer` });
        continue;
      }
      vals[EMP_IDX] = n; // store as JS number so Postgres receives it typed as integer
    }

    validRows.push(vals);
  }

  if (validRows.length === 0) {
    return res.json({ success: true, totalRows, imported: 0, skipped: skippedRows.length, skippedRows });
  }

  // ── 4. Transaction: TEMP TABLE → batched INSERTs → copy into real table ────
  // The real table (tbl_healthcare) only ever receives INSERTs.
  // No DELETE / UPDATE / DROP / TRUNCATE / ALTER is performed anywhere here.
  let industriesAdded = 0;
  try {
    await prisma.$transaction(async (tx) => {
      // Staging table is session-scoped and dropped automatically on COMMIT
      await tx.$executeRawUnsafe(
        `CREATE TEMP TABLE staging_leads (${TEMP_COL_DEFS}) ON COMMIT DROP`
      );

      // Bulk-insert valid rows into staging, 500 rows per batch
      for (let offset = 0; offset < validRows.length; offset += BATCH_SIZE) {
        const batch = validRows.slice(offset, offset + BATCH_SIZE);

        // Value placeholders: ($1,$2,...,$22), ($23,...,$44), ...
        const placeholders = batch
          .map((_, ri) =>
            `(${COLS.map((_, ci) => `$${ri * NUM_COLS + ci + 1}`).join(', ')})`
          )
          .join(', ');

        await tx.$executeRawUnsafe(
          `INSERT INTO staging_leads (${COL_SQL_LIST}) VALUES ${placeholders}`,
          ...batch.flat()
        );
      }

      // Copy all staged rows into the real table — `id` is auto-generated by Postgres
      await tx.$executeRawUnsafe(
        `INSERT INTO tbl_healthcare (${COL_SQL_LIST}) SELECT ${COL_SQL_LIST} FROM staging_leads`
      );

      // Auto-register any NEW industry names into the lookup table so they appear
      // in the industry filter/dropdown. INSERT-only, case-insensitive, de-duped
      // (both against existing rows and within this batch via DISTINCT).
      industriesAdded = await tx.$executeRawUnsafe(`
        INSERT INTO tbl_gtm_industry (industry_name)
        SELECT DISTINCT TRIM(s."GTM Industry")
        FROM staging_leads s
        WHERE s."GTM Industry" IS NOT NULL AND TRIM(s."GTM Industry") <> ''
          AND NOT EXISTS (
            SELECT 1 FROM tbl_gtm_industry g
            WHERE LOWER(TRIM(g.industry_name)) = LOWER(TRIM(s."GTM Industry"))
          )
      `);
    }, { timeout: 120_000 }); // 2-minute timeout for large files

    return res.json({
      success: true,
      totalRows,
      imported: validRows.length,
      skipped:  skippedRows.length,
      newIndustries: industriesAdded,
      skippedRows,
    });
  } catch (err) {
    console.error('Leads import transaction failed:', err);
    return res.status(500).json({ success: false, message: `Import failed: ${err.message}` });
  }
};

module.exports = { upload, importLeads };
