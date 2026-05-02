-- ============================================================================
-- ASSIGNMENT SYSTEM — initial schema
-- Replaces the legacy self-managed shift_logs flow with CEO-assigned shifts
-- and automatic geofence-based entry/exit detection.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. assignments
-- ---------------------------------------------------------------------------
CREATE TABLE public.assignments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  agent_id              uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  assigned_by           uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  store_id              uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,

  shift_date            date NOT NULL,
  scheduled_start_time  time NOT NULL,
  expected_duration_min integer NOT NULL DEFAULT 360,

  status                text NOT NULL DEFAULT 'pending',

  actual_entry_at       timestamptz,
  actual_exit_at        timestamptz,
  effective_minutes     integer NOT NULL DEFAULT 0,

  met_duration          boolean,
  punctuality           text,

  agent_response_at     timestamptz,
  rejection_reason      text,
  cancelled_at          timestamptz,
  cancelled_by          uuid REFERENCES public.users(id),

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT assignments_status_valid CHECK (
    status IN ('pending','accepted','rejected','in_progress','completed','incomplete','cancelled')
  ),
  CONSTRAINT assignments_punctuality_valid CHECK (
    punctuality IS NULL OR punctuality IN ('on_time','late','no_show')
  ),
  CONSTRAINT assignments_start_time_valid CHECK (
    scheduled_start_time >= TIME '10:00'
    AND scheduled_start_time <= TIME '13:00'
    AND EXTRACT(MINUTE FROM scheduled_start_time)::int IN (0, 30)
  ),
  CONSTRAINT assignments_duration_positive CHECK (expected_duration_min > 0),
  CONSTRAINT assignments_effective_nonneg CHECK (effective_minutes >= 0),
  CONSTRAINT assignments_unique_agent_date UNIQUE (agent_id, shift_date)
);

CREATE INDEX assignments_agent_date_idx ON public.assignments (agent_id, shift_date DESC);
CREATE INDEX assignments_status_date_idx ON public.assignments (status, shift_date DESC);
CREATE INDEX assignments_store_date_idx ON public.assignments (store_id, shift_date DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_assignments_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER assignments_updated_at_trigger
  BEFORE UPDATE ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_assignments_updated_at();

-- ---------------------------------------------------------------------------
-- 2. assignment_geofence_events
-- ---------------------------------------------------------------------------
CREATE TABLE public.assignment_geofence_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id   uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,

  event_type      text NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),

  latitude        double precision NOT NULL,
  longitude       double precision NOT NULL,
  distance_meters double precision NOT NULL,
  geo_method      text NOT NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT assignment_events_type_valid CHECK (
    event_type IN ('entered','exited_warn','exited_final','reentered')
  ),
  CONSTRAINT assignment_events_method_valid CHECK (
    geo_method IN ('gps_high','gps_low','ip')
  )
);

CREATE INDEX assignment_events_assignment_idx
  ON public.assignment_geofence_events (assignment_id, occurred_at);
CREATE INDEX assignment_events_type_idx
  ON public.assignment_geofence_events (event_type, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- 3. RLS — match existing project pattern (permissive for anon, real
--    authorization happens server-side in API routes via NextAuth session).
-- ---------------------------------------------------------------------------
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_geofence_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_select_assignments  ON public.assignments FOR SELECT TO anon USING (true);
CREATE POLICY anon_insert_assignments  ON public.assignments FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY anon_update_assignments  ON public.assignments FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_delete_assignments  ON public.assignments FOR DELETE TO anon USING (true);

CREATE POLICY anon_select_assignment_events
  ON public.assignment_geofence_events FOR SELECT TO anon USING (true);
CREATE POLICY anon_insert_assignment_events
  ON public.assignment_geofence_events FOR INSERT TO anon WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 4. Realtime replication
-- ---------------------------------------------------------------------------
ALTER TABLE public.assignments REPLICA IDENTITY FULL;
ALTER TABLE public.assignment_geofence_events REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.assignments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.assignment_geofence_events;
