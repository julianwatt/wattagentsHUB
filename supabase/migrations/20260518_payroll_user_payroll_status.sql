-- =============================================================
-- Payroll System — User payroll_status column (Block 02)
-- Date: 2026-05-18
-- Branch: feature/payroll-system
--
-- Adds a payroll_status column to public.users so we can distinguish
-- "can this person log in" (is_active, auth) from "does this person
-- accrue commissions and overrides in payroll" (payroll_status).
--
-- The two diverge: an off-boarded agent stays payroll_active until
-- their last chargebacks settle, and a temporarily locked account
-- stays payroll_active while we sort out the auth issue.
--
-- Rollback:
--   ALTER TABLE public.users DROP COLUMN payroll_status;
--   DROP TYPE public.user_payroll_status;
-- =============================================================

CREATE TYPE public.user_payroll_status AS ENUM ('active', 'inactive');

ALTER TABLE public.users
  ADD COLUMN payroll_status public.user_payroll_status NOT NULL DEFAULT 'active';

-- One-shot backfill: existing inactive auth users probably should be
-- inactive for payroll too. New rows pick up the default.
UPDATE public.users SET payroll_status = 'inactive' WHERE is_active = false;
