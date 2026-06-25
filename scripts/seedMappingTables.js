/**
 * Seed the three PostgreSQL mapping tables.
 * Run AFTER running create_mapping_tables.sql on Azure.
 *
 * Usage: node scripts/seedMappingTables.js
 * Safe to re-run — uses INSERT ... ON CONFLICT DO UPDATE (upsert).
 */

const { prisma } = require('../utils/prismaClient');

// ─── Region data ──────────────────────────────────────────────────────────────
// countries = lowercase ISO-2 codes that match LOWER("Mailing Country") in tbl_healthcare
// Include known DB quirks: 'india' alongside 'in', etc.
const REGIONS = [
  { name: 'middle east',   display: 'Middle East',    countries: ['ae','sa','qa','kw','bh','om','jo','lb','il','iq','ir','ye','sy','eg','tr'] },
  { name: 'mena',          display: 'MENA',            countries: ['ae','sa','qa','kw','bh','om','jo','lb','il','iq','ir','ye','sy','eg','tr','ma','dz','tn','ly'] },
  { name: 'gcc',           display: 'GCC',             countries: ['sa','ae','qa','kw','bh','om'] },
  { name: 'apac',          display: 'APAC',            countries: ['in','india','cn','jp','sg','au','nz','my','id','kr','th','vn','ph','hk','tw','bd','pk','lk','np'] },
  { name: 'asia pacific',  display: 'Asia Pacific',    countries: ['in','india','cn','jp','sg','au','nz','my','id','kr','th','vn','ph','hk','tw','bd','pk','lk','np'] },
  { name: 'southeast asia',display: 'Southeast Asia',  countries: ['sg','my','id','th','vn','ph','mm','kh','la','bn'] },
  { name: 'south asia',    display: 'South Asia',      countries: ['in','india','pk','bd','lk','np','bt','mv','af'] },
  { name: 'europe',        display: 'Europe',          countries: ['gb','de','fr','nl','se','no','dk','fi','es','it','ch','at','be','ie','pt','pl','cz','hu','ro','gr','lu','hr','sk','si','ee','lv','lt','bg','rs','ua'] },
  { name: 'western europe',display: 'Western Europe',  countries: ['gb','de','fr','nl','be','ch','at','ie','lu','es','pt','it'] },
  { name: 'nordics',       display: 'Nordics',         countries: ['se','no','dk','fi','is'] },
  { name: 'dach',          display: 'DACH',            countries: ['de','at','ch'] },
  { name: 'benelux',       display: 'Benelux',         countries: ['be','nl','lu'] },
  { name: 'north america', display: 'North America',   countries: ['us','ca','mx'] },
  { name: 'latam',         display: 'LATAM',           countries: ['mx','br','ar','co','cl','pe','ve','ec','bo','py','uy','cr','pa','gt','hn','sv','ni','do','cu'] },
  { name: 'latin america', display: 'Latin America',   countries: ['mx','br','ar','co','cl','pe','ve','ec','bo','py','uy','cr','pa','gt','hn','sv','ni','do','cu'] },
  { name: 'africa',        display: 'Africa',          countries: ['za','ng','ke','gh','et','tz','ug','rw','sn','ci','cm','zm','zw','mz','ao'] },
  { name: 'emea',          display: 'EMEA',            countries: ['gb','de','fr','nl','se','no','dk','fi','es','it','ch','at','be','ie','pt','pl','ae','sa','qa','kw','bh','om','jo','eg','tr','za','ng','ke'] },
];

// ─── Segment data ─────────────────────────────────────────────────────────────
const SEGMENTS = [
  { name: 'startup',        display: 'Startup',         min: 1,    max: 50   },
  { name: 'smb',            display: 'SMB',              min: 1,    max: 500  },
  { name: 'small business', display: 'Small Business',  min: 1,    max: 200  },
  { name: 'mid-market',     display: 'Mid-Market',      min: 501,  max: 5000 },
  { name: 'enterprise',     display: 'Enterprise',       min: 5001, max: null },
  { name: 'large enterprise',display:'Large Enterprise', min: 10001,max: null },
];

// ─── Seniority data ───────────────────────────────────────────────────────────
// title_keywords are matched with ILIKE '%keyword%' against the `title` column
const SENIORITY = [
  {
    name: 'decision maker', display: 'Decision Maker',
    keywords: ['Manager','Director','VP','Vice President','Head','Chief','President','Owner','Founder','Partner','Principal']
  },
  {
    name: 'c-suite',        display: 'C-Suite',
    keywords: ['CEO','COO','CFO','CTO','CMO','CRO','CPO','CISO','Chief']
  },
  {
    name: 'vp',             display: 'VP / Vice President',
    keywords: ['VP','Vice President','SVP','EVP']
  },
  {
    name: 'director',       display: 'Director',
    keywords: ['Director','Head of','Global Head']
  },
  {
    name: 'manager',        display: 'Manager',
    keywords: ['Manager','Lead','Supervisor','Team Lead']
  },
  {
    name: 'senior ic',      display: 'Senior Individual Contributor',
    keywords: ['Senior','Sr.','Principal','Staff','Lead']
  },
  {
    name: 'individual contributor', display: 'Individual Contributor',
    keywords: ['Analyst','Specialist','Consultant','Associate','Coordinator','Executive','Representative']
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Converts a JS array to Postgres array literal: ['a','b'] → '{a,b}'
const toPgArray = (arr) => `{${arr.join(',')}}`;

async function run() {
  console.log('Seeding mapping tables...\n');

  // ── Regions ────────────────────────────────────────────────────────────────
  for (const r of REGIONS) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO tbl_regions (region_name, display_name, countries)
      VALUES ($1, $2, $3::text[])
      ON CONFLICT (region_name) DO UPDATE
        SET display_name = EXCLUDED.display_name,
            countries    = EXCLUDED.countries
    `, r.name, r.display, toPgArray(r.countries));
    console.log(`  ✔ region: ${r.name} (${r.countries.length} countries)`);
  }

  // ── Segments ───────────────────────────────────────────────────────────────
  for (const s of SEGMENTS) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO tbl_segments (segment_name, display_name, min_employees, max_employees)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (segment_name) DO UPDATE
        SET display_name  = EXCLUDED.display_name,
            min_employees = EXCLUDED.min_employees,
            max_employees = EXCLUDED.max_employees
    `, s.name, s.display, s.min, s.max);
    const range = s.max ? `${s.min}–${s.max}` : `${s.min}+`;
    console.log(`  ✔ segment: ${s.name} (${range} employees)`);
  }

  // ── Seniority ──────────────────────────────────────────────────────────────
  for (const s of SENIORITY) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO tbl_seniority (level_name, display_name, title_keywords)
      VALUES ($1, $2, $3::text[])
      ON CONFLICT (level_name) DO UPDATE
        SET display_name   = EXCLUDED.display_name,
            title_keywords = EXCLUDED.title_keywords
    `, s.name, s.display, toPgArray(s.keywords));
    console.log(`  ✔ seniority: ${s.name} (${s.keywords.length} keywords)`);
  }

  console.log('\n✅ All mapping tables seeded.');
  await prisma.$disconnect();
}

run().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
