-- ============================================================================
-- Refine assignments uniqueness + add per-user notifications inbox
-- ============================================================================

-- 1. Replace strict UNIQUE with a partial unique index — rejected and
--    cancelled assignments must NOT block creating a replacement for the
--    same agent/date (Sesión 3 BLOQUE 4: trazabilidad de re-asignaciones).
ALTER TABLE public.assignments
  DROP CONSTRAINT assignments_unique_agent_date;

CREATE UNIQUE INDEX assignments_active_unique_per_day
  ON public.assignments (agent_id, shift_date)
  WHERE status IN ('pending','accepted','in_progress','completed','incomplete');

-- 2. user_notifications — symmetric counterpart to admin_notifications, but
--    targeted at a specific recipient (the agent on the receiving end of
--    an assignment, etc). Used by the agent inbox UI in future sessions.
CREATE TABLE public.user_notifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type                text NOT NULL,
  title               text NOT NULL,
  body                text,
  data                jsonb NOT NULL DEFAULT '{}'::jsonb,
  status              text NOT NULL DEFAULT 'pending',
  created_at          timestamptz NOT NULL DEFAULT now(),
  read_at             timestamptz,

  CONSTRAINT user_notifications_status_valid CHECK (status IN ('pending','read','dismissed'))
);

CREATE INDEX user_notifications_recipient_status_idx
  ON public.user_notifications (recipient_user_id, status, created_at DESC);

-- RLS — match project pattern (anon-permissive, real authz in API routes)
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_select_user_notifications ON public.user_notifications FOR SELECT TO anon USING (true);
CREATE POLICY anon_insert_user_notifications ON public.user_notifications FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY anon_update_user_notifications ON public.user_notifications FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_delete_user_notifications ON public.user_notifications FOR DELETE TO anon USING (true);

-- Realtime
ALTER TABLE public.user_notifications REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
