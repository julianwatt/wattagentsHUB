-- =============================================================
-- Payroll System — PDF storage + user language (Block 07)
-- Date: 2026-05-23
-- Branch: feature/payroll-system
--
-- Two things needed for the snapshot + PDF flow:
--   1. A private Storage bucket `payfile-pdfs` that holds the per-version
--      PDF files. Path layout (chosen by the API, not enforced at DB):
--          {user_id}/{pay_week}/v{version_number}.pdf
--      service_role bypasses RLS, so server-side code reads/writes freely.
--      No anon/authenticated policies. Browser-direct downloads happen via
--      short-lived signed URLs minted in /api/payroll/payfiles/[id]/download.
--   2. users.language — 'es' | 'en'. Drives PDF localisation (block 07)
--      and any future per-user UI default. Defaults to 'es' for every
--      existing row (project's primary language is Mexican Spanish).
--
-- payfile_versions itself is unchanged — block 01 already declared
-- the table with snapshot_json + pdf_path + version_number + the
-- (payfile_id, version_number) UNIQUE constraint.
--
-- Rollback:
--   ALTER TABLE public.users DROP COLUMN IF EXISTS language;
--   DELETE FROM storage.buckets WHERE id = 'payfile-pdfs';
-- =============================================================

-- 1. STORAGE BUCKET
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payfile-pdfs',
  'payfile-pdfs',
  false,
  10485760, -- 10 MB per PDF (generous; real files are < 200 KB)
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- 2. users.language
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'es'
    CHECK (language IN ('es', 'en'));

COMMENT ON COLUMN public.users.language IS
  'Preferred language for this user. Drives the generated payfile PDF (block 07) and the default in-app language hint.';
