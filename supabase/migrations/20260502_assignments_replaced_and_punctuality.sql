-- Add 'replaced' status + new punctuality buckets, plus dedupe historical
-- rows. Mirrors what was applied via the Supabase MCP for the live project.

ALTER TABLE public.assignments DROP CONSTRAINT IF EXISTS assignments_status_check;
ALTER TABLE public.assignments DROP CONSTRAINT IF EXISTS assignments_status_valid;
ALTER TABLE public.assignments ADD CONSTRAINT assignments_status_check
  CHECK (status = ANY (ARRAY['pending','accepted','rejected','in_progress','completed','incomplete','cancelled','replaced']::text[]));

ALTER TABLE public.assignments DROP CONSTRAINT IF EXISTS assignments_punctuality_check;
ALTER TABLE public.assignments DROP CONSTRAINT IF EXISTS assignments_punctuality_valid;
ALTER TABLE public.assignments ADD CONSTRAINT assignments_punctuality_check
  CHECK ((punctuality IS NULL) OR (punctuality = ANY (ARRAY['on_time','late','late_arrival','late_severe','no_show']::text[])));

-- Live-set unique index excludes 'replaced' (it joins rejected/cancelled in
-- the historical set), so a fresh assignment can supersede a replaced one
-- without violating the partial-unique constraint.
DROP INDEX IF EXISTS public.assignments_active_unique_per_day;
CREATE UNIQUE INDEX assignments_active_unique_per_day
  ON public.assignments USING btree (agent_id, shift_date)
  WHERE (status = ANY (ARRAY['pending','accepted','in_progress','completed','incomplete']::text[]));

-- One-shot dedupe of historical rows: when a (agent, day) had multiple
-- non-live assignments accumulated, keep only the most recent one and
-- mark the rest 'replaced'. Live rows are untouched. Once running this
-- block locally is a no-op because the new POST flow stamps 'replaced'
-- as the previous row is superseded.
WITH live_per_day AS (
  SELECT agent_id, shift_date FROM public.assignments
  WHERE status IN ('pending','accepted','in_progress','completed','incomplete')
),
non_live AS (
  SELECT a.id, a.agent_id, a.shift_date, a.created_at,
    ROW_NUMBER() OVER (PARTITION BY a.agent_id, a.shift_date ORDER BY a.created_at DESC) AS rn
  FROM public.assignments a
  WHERE a.status IN ('rejected','cancelled')
)
UPDATE public.assignments
SET status = 'replaced'
WHERE id IN (
  SELECT nl.id FROM non_live nl
  WHERE EXISTS (SELECT 1 FROM live_per_day lp
                WHERE lp.agent_id = nl.agent_id AND lp.shift_date = nl.shift_date)
     OR (nl.rn > 1)
);
