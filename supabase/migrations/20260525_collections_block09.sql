-- =============================================================
-- Payroll System — Collections support (Block 09)
-- Date: 2026-05-25
-- Branch: feature/payroll-system
--
-- Two enum widenings + a helper index. The collections and
-- collection_installments tables themselves are unchanged — block 01
-- declared the columns; block 09 just needs:
--
--   1. payfile_line_type += 'COLLECTION_INCOME'
--      Positive credit line on the beneficiary's payfile when the
--      debtor pays a collection installment. The existing 'COLLECTION'
--      type is reserved for the debtor's negative deduction line.
--
--   2. collection_installment_status += 'CANCELLED'
--      When admin cancels a collection mid-cycle, every PENDING /
--      PARTIALLY_COLLECTED installment that hasn't run gets flipped
--      to CANCELLED so the calc skips it.
--
--   3. collection_installments_scheduled_status_idx
--      The apply query in calculatePayrollForWeek looks up
--      installments by (scheduled_week, status) per debtor. Helpful
--      composite index for the common pattern.
--
-- Postgres requires ALTER TYPE ... ADD VALUE outside a transaction in
-- some versions. Both statements here are idempotent.
--
-- Rollback (manual, requires recreating the enum):
--   This migration is non-destructive of existing data. To remove
--   the new values you'd need to recreate the type — not worth it
--   unless the enum is wrong.
-- =============================================================

-- 1. payfile_line_type += COLLECTION_INCOME
ALTER TYPE public.payfile_line_type
  ADD VALUE IF NOT EXISTS 'COLLECTION_INCOME';

-- 2. collection_installment_status += CANCELLED
ALTER TYPE public.collection_installment_status
  ADD VALUE IF NOT EXISTS 'CANCELLED';

-- 3. Helper index for the per-week apply query.
CREATE INDEX IF NOT EXISTS collection_installments_scheduled_status_idx
  ON public.collection_installments (scheduled_week, status);

COMMENT ON COLUMN public.payfile_line_items.line_type IS
  'COMMISSION / OVERRIDE = block 06; COMPANY_BONUS = block 04; NEGATIVE_BALANCE_COLLECTION = block 08 (debtor side); COLLECTION = block 09 debtor deduction (negative amount); COLLECTION_INCOME = block 09 beneficiary credit (positive amount); MANUAL_ADJUSTMENT = ad-hoc admin adds.';
