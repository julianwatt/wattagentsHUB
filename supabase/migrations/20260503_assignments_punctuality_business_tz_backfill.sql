-- Recompute punctuality for every assignment with actual_entry_at, using
-- America/Chicago as the business timezone. The previous code paired
-- shift_date+scheduled_start_time as if they were UTC, which placed every
-- entry 5–6h "late" in the bucket — exactly the bug Armando reported.
--
-- This migration backfills historical rows. New rows go through
-- punctualityForEntry() in lib/assignmentGeofence.ts which now uses the same
-- America/Chicago anchor.
WITH calc AS (
  SELECT
    a.id,
    EXTRACT(EPOCH FROM (
      a.actual_entry_at
      - ((a.shift_date::text || ' ' || a.scheduled_start_time::text)::timestamp AT TIME ZONE 'America/Chicago')
    )) / 60 AS diff_min
  FROM public.assignments a
  WHERE a.actual_entry_at IS NOT NULL
    AND a.status NOT IN ('cancelled','replaced')
)
UPDATE public.assignments a SET punctuality =
  CASE
    WHEN c.diff_min <= 5 THEN 'on_time'
    WHEN c.diff_min <= 30 THEN 'late'
    WHEN c.diff_min <= 120 THEN 'late_arrival'
    ELSE 'late_severe'
  END
FROM calc c
WHERE a.id = c.id;
