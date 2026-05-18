-- =============================================================
-- Block 14 — Audit Log & Sales Tracking: search + filter indexes
-- Date: 2026-05-22
-- Branch: feature/payroll-system
--
-- Goals:
--   1. Enable fast ILIKE / trigram searches on payroll_sales for the
--      Rastreo free-text bar (contract_id, customer_name, plan_name,
--      source_file_name, je_badge).
--   2. Speed up audit-log filtering by created_at (date range), by
--      entity_type alone, and case-insensitive change_notes search.
--
-- Strategy: pg_trgm GIN indexes for partial-string search; B-tree
-- indexes for plain equality / range scans.
--
-- All indexes use IF NOT EXISTS so this migration is idempotent.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── payroll_sales: free-text search ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS payroll_sales_contract_id_trgm_idx
  ON public.payroll_sales USING GIN (contract_id gin_trgm_ops);

CREATE INDEX IF NOT EXISTS payroll_sales_customer_trgm_idx
  ON public.payroll_sales USING GIN (customer_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS payroll_sales_plan_name_trgm_idx
  ON public.payroll_sales USING GIN (plan_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS payroll_sales_source_file_trgm_idx
  ON public.payroll_sales USING GIN (source_file_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS payroll_sales_je_badge_trgm_idx
  ON public.payroll_sales USING GIN (je_badge gin_trgm_ops);

-- ── payroll_sales: filterable single columns ──────────────────────────────
CREATE INDEX IF NOT EXISTS payroll_sales_status_idx
  ON public.payroll_sales (status);

CREATE INDEX IF NOT EXISTS payroll_sales_signed_date_idx
  ON public.payroll_sales (contract_signed_date DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS payroll_sales_is_winback_idx
  ON public.payroll_sales (is_winback)
  WHERE is_winback = true;

-- ── payroll_audit_log: date range / type-only filters ──────────────────────
CREATE INDEX IF NOT EXISTS payroll_audit_created_at_idx
  ON public.payroll_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS payroll_audit_entity_type_idx
  ON public.payroll_audit_log (entity_type, created_at DESC);

CREATE INDEX IF NOT EXISTS payroll_audit_action_idx
  ON public.payroll_audit_log (action, created_at DESC);

-- Trigram on change_notes for the audit free-text bar. The column is
-- nullable; GIN handles NULLs by simply not indexing them.
CREATE INDEX IF NOT EXISTS payroll_audit_notes_trgm_idx
  ON public.payroll_audit_log USING GIN (change_notes gin_trgm_ops);

-- =============================================================
-- ROLLBACK (manual):
--   DROP INDEX IF EXISTS public.payroll_sales_contract_id_trgm_idx;
--   DROP INDEX IF EXISTS public.payroll_sales_customer_trgm_idx;
--   DROP INDEX IF EXISTS public.payroll_sales_plan_name_trgm_idx;
--   DROP INDEX IF EXISTS public.payroll_sales_source_file_trgm_idx;
--   DROP INDEX IF EXISTS public.payroll_sales_je_badge_trgm_idx;
--   DROP INDEX IF EXISTS public.payroll_sales_status_idx;
--   DROP INDEX IF EXISTS public.payroll_sales_signed_date_idx;
--   DROP INDEX IF EXISTS public.payroll_sales_is_winback_idx;
--   DROP INDEX IF EXISTS public.payroll_audit_created_at_idx;
--   DROP INDEX IF EXISTS public.payroll_audit_entity_type_idx;
--   DROP INDEX IF EXISTS public.payroll_audit_action_idx;
--   DROP INDEX IF EXISTS public.payroll_audit_notes_trgm_idx;
--   -- pg_trgm extension left in place; harmless if unused.
-- =============================================================
