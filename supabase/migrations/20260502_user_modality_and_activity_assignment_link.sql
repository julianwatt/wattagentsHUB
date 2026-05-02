-- ============================================================================
-- Sesión 9: agent modality (d2d / retail / both) + activity_entries link to
-- the assignment of the day.
-- ============================================================================

-- 1. users.modality
ALTER TABLE public.users
  ADD COLUMN modality text NOT NULL DEFAULT 'd2d'
  CHECK (modality IN ('d2d', 'retail', 'both'));

-- All current agents stay D2D (default). The CEO can change this from the
-- Manage Users screen. New users default to 'd2d' too.

-- 2. activity_entries.assignment_id — links a day's activity record to the
--    accepted assignment for that date. Nullable because:
--      - D2D agents have no store/assignment
--      - Existing rows pre-date this column
--      - If an assignment is hard-deleted, ON DELETE SET NULL keeps the
--        activity row intact for audit ("orphan").
ALTER TABLE public.activity_entries
  ADD COLUMN assignment_id uuid REFERENCES public.assignments(id) ON DELETE SET NULL;

CREATE INDEX activity_entries_assignment_id_idx
  ON public.activity_entries (assignment_id)
  WHERE assignment_id IS NOT NULL;
