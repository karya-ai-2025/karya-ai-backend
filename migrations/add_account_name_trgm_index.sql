-- One-time migration: trigram index on "Account Name" for fast ILIKE search
-- Safe: creates extension and index only if they don't already exist.
-- Does NOT modify, delete, or restructure any data or table.
-- Reversible: DROP INDEX idx_account_name_trgm;
--
-- Run once against the Azure database:
--   psql "<your DATABASE_URL>" -f migrations/add_account_name_trgm_index.sql
-- Or via Azure Portal: Open Query Editor and paste the two statements below.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_account_name_trgm
  ON tbl_healthcare USING gin ("Account Name" gin_trgm_ops);
