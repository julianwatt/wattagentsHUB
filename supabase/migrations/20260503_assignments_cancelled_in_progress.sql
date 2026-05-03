-- New 'cancelled_in_progress' status: a CEO/Admin cancellation that happens
-- AFTER the agent already arrived at the perimeter. Distinct from 'cancelled'
-- (pre-arrival) so the UI can show "Terminada por CEO" vs plain "Cancelada"
-- and so historical exports can audit the difference. Both statuses share
-- the same lifecycle: terminal, hidden from the active panel, kept in
-- history.
ALTER TABLE public.assignments DROP CONSTRAINT IF EXISTS assignments_status_check;
ALTER TABLE public.assignments ADD CONSTRAINT assignments_status_check
  CHECK (status = ANY (ARRAY[
    'pending','accepted','rejected','in_progress','completed','incomplete',
    'cancelled','cancelled_in_progress','replaced'
  ]::text[]));
