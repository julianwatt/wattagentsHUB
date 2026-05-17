-- =============================================================
-- Payroll System — Negative balances + winback consolidation (Block 08)
-- Date: 2026-05-24
-- Branch: feature/payroll-system
--
-- Three schema tweaks:
--   1. payfiles.had_negative_balance — TRUE when the calc closed
--      negative and the residual rolled into negative_balances. The
--      published total is forced to 0 in that case.
--   2. negative_balances.auto_generated_for_payfile_id — links an
--      auto-created balance back to the payfile that produced it.
--      Lets calculatePayrollForWeek wipe + recreate cleanly on recalc
--      while leaving manually-created balances alone.
--   3. admin_notifications.type CHECK widened to include
--      'payroll_balance_reactivated' for the inactive→active hook
--      added in block 08.
--
-- Rollback:
--   ALTER TABLE public.payfiles DROP COLUMN IF EXISTS had_negative_balance;
--   ALTER TABLE public.negative_balances DROP COLUMN IF EXISTS auto_generated_for_payfile_id;
--   ALTER TABLE public.admin_notifications DROP CONSTRAINT IF EXISTS admin_notifications_type_check;
--   (restore the previous CHECK from 20260502)
-- =============================================================

-- 1. payfiles.had_negative_balance
ALTER TABLE public.payfiles
  ADD COLUMN IF NOT EXISTS had_negative_balance boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.payfiles.had_negative_balance IS
  'TRUE when calculatePayrollForWeek closed this payfile with total_amount < 0 and rolled the residual into negative_balances. The published total is forced to 0 in that case.';

-- 2. negative_balances.auto_generated_for_payfile_id
ALTER TABLE public.negative_balances
  ADD COLUMN IF NOT EXISTS auto_generated_for_payfile_id uuid
    REFERENCES public.payfiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS negative_balances_auto_pf_idx
  ON public.negative_balances (auto_generated_for_payfile_id);

COMMENT ON COLUMN public.negative_balances.auto_generated_for_payfile_id IS
  'Set when the calc orchestrator created this balance for a negative-total payfile. NULL for manually-created balances (block 04 inactive-user chargebacks, block 06 inactive-manager chargebacks, future manual admin entries). On recalc we wipe + recreate only auto rows.';

-- 3. admin_notifications.type — widen for the inactive→active hook
ALTER TABLE public.admin_notifications
  DROP CONSTRAINT IF EXISTS admin_notifications_type_check;

ALTER TABLE public.admin_notifications
  ADD CONSTRAINT admin_notifications_type_check
  CHECK (type IN (
    'password_reset',
    'password_change',
    'user_deactivated',
    'user_activated',
    'daily_summary',
    'geofence_alert',
    'assignment_arrived',
    'assignment_exited_warn',
    'assignment_exited_final',
    'assignment_reentered',
    'assignment_accepted',
    'assignment_rejected',
    -- Block 08: pending negative balance + user just got reactivated
    'payroll_balance_reactivated'
  ));
