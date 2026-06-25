-- Mapping tables: translate fuzzy human concepts into concrete SQL filters
-- Safe to run multiple times (all statements use IF NOT EXISTS)
-- Run once: paste into Azure Portal Query Editor

-- ─── 1. REGIONS ──────────────────────────────────────────────────────────────
-- Maps a region name → array of lowercase ISO-2 country codes
-- "APAC" → WHERE LOWER("Mailing Country") = ANY(countries)
CREATE TABLE IF NOT EXISTS tbl_regions (
  id           serial PRIMARY KEY,
  region_name  text   NOT NULL UNIQUE,   -- lowercase, e.g. 'apac', 'middle east'
  display_name text,                      -- human label, e.g. 'APAC'
  countries    text[] NOT NULL DEFAULT '{}'  -- lowercase ISO-2 codes, e.g. '{in,cn,jp}'
);

-- ─── 2. SEGMENTS ─────────────────────────────────────────────────────────────
-- Maps a size band name → employee count range
-- "SMB" → WHERE employees BETWEEN min_employees AND max_employees
CREATE TABLE IF NOT EXISTS tbl_segments (
  id            serial  PRIMARY KEY,
  segment_name  text    NOT NULL UNIQUE,  -- lowercase, e.g. 'smb', 'enterprise'
  display_name  text,
  min_employees integer,                  -- NULL = no lower bound
  max_employees integer                   -- NULL = no upper bound (e.g. enterprise)
);

-- ─── 3. SENIORITY ────────────────────────────────────────────────────────────
-- Maps a seniority level → title keywords to match against the `title` column
-- "decision maker" → WHERE title ILIKE ANY('{%Director%,%VP%,%Chief%,...}')
CREATE TABLE IF NOT EXISTS tbl_seniority (
  id             serial PRIMARY KEY,
  level_name     text   NOT NULL UNIQUE,  -- lowercase, e.g. 'decision maker', 'c-suite'
  display_name   text,
  title_keywords text[] NOT NULL DEFAULT '{}'  -- stored without %, added at query time
);
