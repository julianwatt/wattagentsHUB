-- =============================================================
-- Payroll System — Uploads, Storage and parsing support (Block 04)
-- Date: 2026-05-20
-- Branch: feature/payroll-system
--
-- Adds what's needed to support file uploads and parsing on top of the
-- block-01 schema:
--   - A private Storage bucket `payroll-uploads` for the raw .xlsx files.
--   - New columns on payroll_uploads to track principal/bonus, processing
--     state, error count, soft delete, processed_at and pay_week.
--   - A row-level errors table for parse failures that don't kill the file.
--   - Partial-unique index on file_name (live rows only) so soft-deleted
--     uploads don't block re-uploads of the same name.
--
-- Storage strategy: project convention is server-only access via
-- service_role. Bucket is created as private (public=false) and no policies
-- are added on storage.objects for this bucket — service_role bypasses RLS,
-- so the API routes can read/write freely. Anon and authenticated roles
-- get no access at all.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.payroll_upload_row_errors CASCADE;
--   ALTER TABLE public.payroll_uploads
--     DROP COLUMN IF EXISTS file_type,
--     DROP COLUMN IF EXISTS processing_status,
--     DROP COLUMN IF EXISTS error_count,
--     DROP COLUMN IF EXISTS file_size_bytes,
--     DROP COLUMN IF EXISTS deleted_at,
--     DROP COLUMN IF EXISTS processed_at,
--     DROP COLUMN IF EXISTS pay_week;
--   DROP INDEX IF EXISTS public.payroll_uploads_file_name_live_unique;
--   ALTER TABLE public.payroll_uploads ADD CONSTRAINT payroll_uploads_file_name_key UNIQUE (file_name);
--   DROP TYPE IF EXISTS public.payroll_upload_processing_status;
--   DROP TYPE IF EXISTS public.payroll_upload_file_type;
--   DELETE FROM storage.buckets WHERE id = 'payroll-uploads';
-- =============================================================

-- =========================================================================
-- 1. STORAGE BUCKET
-- =========================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payroll-uploads',
  'payroll-uploads',
  false,
  52428800, -- 50 MB
  ARRAY[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/octet-stream'  -- some browsers send this for .xlsx
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Intentionally NO storage.objects policies for this bucket. service_role
-- bypasses RLS so server-side code works; anon and authenticated clients
-- have no access. If you ever need browser-direct downloads, add a SELECT
-- policy gated by user role (do NOT make the bucket public).

-- =========================================================================
-- 2. ENUMS
-- =========================================================================
CREATE TYPE public.payroll_upload_file_type AS ENUM ('PRINCIPAL', 'BONUS');

CREATE TYPE public.payroll_upload_processing_status AS ENUM (
  'PENDING',     -- uploaded, not yet processed
  'PROCESSING',  -- parser running (best-effort marker; sync flow may skip)
  'PROCESSED',   -- finished, zero row errors
  'PARTIAL',     -- finished, some rows failed (see payroll_upload_row_errors)
  'FAILED'       -- catastrophic parse error, no rows inserted
);

-- =========================================================================
-- 3. EXTEND payroll_uploads
-- =========================================================================

-- Drop the strict UNIQUE on file_name — admin needs to be able to force-
-- replace a previous upload with the same name. We re-add a PARTIAL UNIQUE
-- below that ignores soft-deleted rows.
ALTER TABLE public.payroll_uploads
  DROP CONSTRAINT IF EXISTS payroll_uploads_file_name_key;

ALTER TABLE public.payroll_uploads
  ADD COLUMN file_type          public.payroll_upload_file_type NOT NULL DEFAULT 'PRINCIPAL',
  ADD COLUMN processing_status  public.payroll_upload_processing_status NOT NULL DEFAULT 'PENDING',
  ADD COLUMN error_count        integer NOT NULL DEFAULT 0,
  ADD COLUMN file_size_bytes    bigint,
  ADD COLUMN deleted_at         timestamptz,
  ADD COLUMN processed_at       timestamptz,
  ADD COLUMN pay_week           date;
-- pay_week is the Friday this upload's PAYABLE rows count for. Admin confirms
-- it at upload time (defaulting to the Friday on/after cutoff_date). Sales
-- with PAYABLE_NEXT_WEEK status get pay_week + 7.

CREATE UNIQUE INDEX payroll_uploads_file_name_live_unique
  ON public.payroll_uploads (file_name)
  WHERE deleted_at IS NULL;

CREATE INDEX payroll_uploads_status_idx
  ON public.payroll_uploads (processing_status)
  WHERE deleted_at IS NULL;

CREATE INDEX payroll_uploads_pay_week_idx
  ON public.payroll_uploads (pay_week)
  WHERE deleted_at IS NULL;

-- =========================================================================
-- 4. payroll_upload_row_errors
-- =========================================================================
-- One row per parsing failure that didn't kill the whole file. Surfaced in
-- the upload detail view so admin can decide what to do (fix and reprocess,
-- ignore, etc.).
CREATE TABLE public.payroll_upload_row_errors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id     uuid NOT NULL REFERENCES public.payroll_uploads(id) ON DELETE CASCADE,
  row_number    integer NOT NULL,  -- 1-based index in the source sheet
  raw_row       jsonb,
  error_message text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payroll_upload_row_errors_upload_idx
  ON public.payroll_upload_row_errors (upload_id);

ALTER TABLE public.payroll_upload_row_errors ENABLE ROW LEVEL SECURITY;
-- No policies — admin-only, server-side via service_role.

-- =========================================================================
-- 5. BACKFILL for existing rows
-- =========================================================================
-- The columns above have DEFAULTs that cover historical rows. pay_week is
-- nullable so legacy rows (none in production yet) stay valid. No-op in
-- practice since block 04 ships before any production upload.

COMMENT ON COLUMN public.payroll_uploads.file_type IS
  'PRINCIPAL or BONUS — multiple uploads can share the same cutoff/pay_week.';
COMMENT ON COLUMN public.payroll_uploads.processing_status IS
  'PENDING → PROCESSING → PROCESSED/PARTIAL/FAILED. PARTIAL means some rows landed in payroll_upload_row_errors.';
COMMENT ON COLUMN public.payroll_uploads.pay_week IS
  'Friday of the pay week these PAYABLE rows count for. PAYABLE_NEXT_WEEK rows = pay_week + 7 days.';
COMMENT ON COLUMN public.payroll_uploads.deleted_at IS
  'Soft delete. Set when admin removes an upload; orphans payroll_sales rows that were not yet pinned to a published payfile.';
