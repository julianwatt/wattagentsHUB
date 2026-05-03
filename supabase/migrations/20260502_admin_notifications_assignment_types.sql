-- ============================================================================
-- Widen admin_notifications.type CHECK constraint for assignment events
-- ============================================================================
-- The assignment system inserts admin_notifications rows from two routes:
--   1. /api/assignments/[id]/geofence-event — arrival, temporary exit,
--      final exit, and re-entry events from the per-shift geofence.
--      Types: assignment_arrived, assignment_exited_warn,
--             assignment_exited_final, assignment_reentered.
--   2. /api/assignments/[id] PATCH — agent accept/reject of a pending
--      assignment.
--      Types: assignment_accepted, assignment_rejected.
--
-- The previous CHECK constraint (added in 20260423_shift_tracking.sql)
-- only allowed 6 legacy types, so every assignment-system INSERT failed
-- with 23514 check_violation. The error was caught and only logged, so
-- push notifications went out (separate code path) but the in-app rows
-- never persisted — the CEO's bell + notifications page were blind to
-- perimeter events and to agent accept/reject responses.
--
-- This migration widens the constraint to include the 6 assignment event
-- types alongside the existing 6 legacy ones. Mirrors what was applied
-- via the Supabase MCP for the live project.

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
    'assignment_rejected'
  ));
