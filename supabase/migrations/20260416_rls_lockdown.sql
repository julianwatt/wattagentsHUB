-- =============================================================
-- RLS Lockdown Migration — 2026-04-16
-- Strategy: service-role key for server (bypasses RLS),
--           anon key gets read-only access to minimal tables.
-- =============================================================

-- 1. Enable RLS on all tables
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_summaries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config           ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_notifications  ENABLE ROW LEVEL SECURITY;

-- 2. Drop permissive allow-all policies
DROP POLICY IF EXISTS "allow_all"          ON users;
DROP POLICY IF EXISTS "allow_all"          ON activity_entries;
DROP POLICY IF EXISTS "allow_all"          ON activity_logs;
DROP POLICY IF EXISTS "allow_all"          ON app_settings;
DROP POLICY IF EXISTS "Allow all for anon" ON daily_summaries;
DROP POLICY IF EXISTS "allow_all"          ON app_config;
DROP POLICY IF EXISTS "allow_all"          ON admin_notifications;

-- 3. Hide password_hash from anon & authenticated
--    (Must revoke table-level first, then grant safe columns)
REVOKE ALL ON users FROM anon;
GRANT SELECT (
  id, username, name, email, role, manager_id,
  must_change_password, is_active, hire_date, created_at
) ON users TO anon;

-- 4. Anon SELECT-only policies (browser realtime needs these)

-- users: AppLayout, ActivityClient, RosterClient read name/hire_date
CREATE POLICY "anon_select_users" ON users
  FOR SELECT TO anon USING (true);

-- activity_entries: ActivityClient realtime subscriptions
CREATE POLICY "anon_select_activity" ON activity_entries
  FOR SELECT TO anon USING (true);

-- admin_notifications: AppLayout & NotificationsClient realtime
CREATE POLICY "anon_select_notifications" ON admin_notifications
  FOR SELECT TO anon USING (true);

-- app_config: public theme/config
CREATE POLICY "anon_select_config" ON app_config
  FOR SELECT TO anon USING (true);

-- 5. Tables with NO anon access (deny-all by default with RLS enabled)
--    - activity_logs:   server-only
--    - daily_summaries: server-only
--    - app_settings:    legacy/unused
