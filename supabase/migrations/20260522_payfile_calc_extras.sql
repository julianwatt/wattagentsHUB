-- =============================================================
-- Payroll System — Payfile calculation schema extras (Block 06)
-- Date: 2026-05-22
-- Branch: feature/payroll-system
--
-- Two small flag columns the block-06 orchestrator needs to keep manual
-- edits and manual additions safe across recalculations:
--   - payfile_line_items.is_manually_added — set by the "agregar línea"
--     UI; the recalc pass deletes only is_manually_added=false rows.
--   - payfile_line_items.requires_ceo_approval — set when an admin edits
--     a line item to an amount above 3× the source's je_paid_amount.
--     canPublishPayfile (block 11) refuses to publish until cleared.
--   - payfile_overrides.is_manually_added — same idea for overrides
--     created via the "agregar manager" UI flow.
--
-- Also adds an index for the chargeback-history lookup the orchestrator
-- runs per CHARGEBACK row.
--
-- Rollback:
--   DROP INDEX IF EXISTS public.payroll_sales_contract_plan_idx;
--   ALTER TABLE public.payfile_overrides   DROP COLUMN IF EXISTS is_manually_added;
--   ALTER TABLE public.payfile_line_items  DROP COLUMN IF EXISTS is_manually_added,
--                                         DROP COLUMN IF EXISTS requires_ceo_approval;
-- =============================================================

ALTER TABLE public.payfile_line_items
  ADD COLUMN is_manually_added     boolean NOT NULL DEFAULT false,
  ADD COLUMN requires_ceo_approval boolean NOT NULL DEFAULT false;

ALTER TABLE public.payfile_overrides
  ADD COLUMN is_manually_added boolean NOT NULL DEFAULT false;

-- The chargeback-history lookup hits payroll_sales by (contract_id, plan_name)
-- to find the originating PAYABLE/CANCELLED row, then joins to
-- payfile_line_items by source_sale_id. The existing
-- payroll_sales_contract_status_idx covers (contract_id, status); this
-- complements it for the cross-status walk.
CREATE INDEX IF NOT EXISTS payroll_sales_contract_plan_idx
  ON public.payroll_sales (contract_id, plan_name);

COMMENT ON COLUMN public.payfile_line_items.is_manually_added IS
  'TRUE when admin/CEO added this line outside the calc pipeline. calculatePayrollForWeek preserves these on recalc.';
COMMENT ON COLUMN public.payfile_line_items.requires_ceo_approval IS
  'TRUE when an admin edit pushed amount above 3× je_paid_amount. canPublishPayfile blocks publication until cleared.';
COMMENT ON COLUMN public.payfile_overrides.is_manually_added IS
  'TRUE when admin/CEO inserted an override outside the calc pipeline. calculatePayrollForWeek preserves these on recalc.';
