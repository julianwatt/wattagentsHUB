-- =============================================================
-- Block 15 — centralized notification system
-- Date: 2026-05-23
-- Branch: feature/payroll-system
--
-- Two changes:
--   1. Widen public.admin_notifications.type CHECK to cover the new
--      payroll-side admin/CEO alerts (orphan badges, unmapped plans,
--      file errors, week rejected, items >3x pending, large-change
--      republish, week ready for approval).
--   2. New table public.payroll_notification_queue — async push queue.
--      dispatchPayrollNotification writes the in-app row synchronously
--      and enqueues here for the push side. A worker route processes
--      pending rows with bounded retries.
-- =============================================================

-- ── 1. admin_notifications.type CHECK widening ────────────────────────────
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
    -- Block 08
    'payroll_balance_reactivated',
    -- Block 15 — admin/CEO inbox alerts
    'payroll_orphan_badges_detected',
    'payroll_unmapped_plans_detected',
    'payroll_file_processed_with_errors',
    'payroll_week_rejected_by_ceo',
    'payroll_items_over_3x_pending',
    'payroll_large_change_republish',
    'payroll_week_ready_for_approval'
  ));

-- ── 2. payroll_notification_queue ─────────────────────────────────────────
-- Async push dispatch. Status flow:
--   pending → sent  (worker dispatched push OK)
--           → failed (transient retried up to max_attempts, or hard fail)
--
-- The queue is independent from the inbox rows (admin_notifications /
-- user_notifications) so the in-app side renders immediately even if push
-- isn't configured / suscription is missing. The worker only touches the
-- queue.
CREATE TABLE public.payroll_notification_queue (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type  text NOT NULL,
  recipient_user_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  payload            jsonb NOT NULL DEFAULT '{}'::jsonb,
  status             text NOT NULL DEFAULT 'pending',
  attempts           int  NOT NULL DEFAULT 0,
  max_attempts       int  NOT NULL DEFAULT 3,
  last_error         text,
  scheduled_for      timestamptz NOT NULL DEFAULT now(),
  processed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payroll_notif_queue_status_valid
    CHECK (status IN ('pending', 'sent', 'failed')),
  CONSTRAINT payroll_notif_queue_attempts_valid
    CHECK (attempts >= 0 AND attempts <= max_attempts)
);

CREATE INDEX payroll_notif_queue_pending_idx
  ON public.payroll_notification_queue (status, scheduled_for)
  WHERE status = 'pending';

CREATE INDEX payroll_notif_queue_recipient_idx
  ON public.payroll_notification_queue (recipient_user_id, created_at DESC);

ALTER TABLE public.payroll_notification_queue ENABLE ROW LEVEL SECURITY;
-- No anon policies — service-role-only via API routes.

COMMENT ON TABLE public.payroll_notification_queue IS
  'Block 15 — async push dispatch queue. Inbox rows are written sync to admin_notifications / user_notifications; the push channel is enqueued here and drained by /api/payroll/notifications/process with bounded retries.';

-- =============================================================
-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS public.payroll_notification_queue CASCADE;
--   ALTER TABLE public.admin_notifications
--     DROP CONSTRAINT IF EXISTS admin_notifications_type_check;
--   -- restore block 08 CHECK if you need full rollback.
-- =============================================================
