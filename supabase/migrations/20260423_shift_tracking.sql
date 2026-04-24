-- =============================================================
-- Shift Tracking Migration — 2026-04-23
-- Tables: stores, shift_logs, push_subscriptions, geofence_alerts
-- Strategy: anon read-only, server uses service-role (bypasses RLS)
-- =============================================================

-- ── TABLA: stores ──
create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  latitude double precision not null,
  longitude double precision not null,
  geofence_radius_meters integer default 200,
  created_at timestamptz default now()
);

-- ── TABLA: shift_logs ──
create table public.shift_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  store_id uuid references public.stores(id),
  event_type text check (event_type in ('clock_in','lunch_start','lunch_end','clock_out')),
  event_time timestamptz default now(),
  latitude double precision,
  longitude double precision,
  is_at_location boolean,
  distance_meters double precision,
  geo_method text,
  created_at timestamptz default now()
);

-- ── TABLA: push_subscriptions ──
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  subscription jsonb not null,
  created_at timestamptz default now(),
  unique (user_id)
);

-- ── TABLA: geofence_alerts ──
create table public.geofence_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  store_id uuid references public.stores(id),
  alert_type text check (alert_type in ('outside_perimeter','location_mismatch')),
  latitude double precision,
  longitude double precision,
  distance_meters double precision,
  notified_at timestamptz default now(),
  shift_log_id uuid references public.shift_logs(id)
);

-- ── SEED: Tiendas ──
insert into public.stores (name, address, latitude, longitude, geofence_radius_meters)
values (
  'Watt Distributors Office – Irving',
  '4425 W Airport Fwy, Ste 145, Irving, TX 75062, United States',
  32.83867021079666,
  -97.01236531587371,
  200
);

insert into public.stores (name, latitude, longitude, geofence_radius_meters)
values (
  'Admin Office',
  25.875175698036486,
  -97.54208052208608,
  200
);

-- =============================================================
-- RLS — Patrón existente: anon full CRUD (misma estrategia que
-- activity_entries). Autorización se maneja en API routes con
-- getServerSession(). No se usa authenticated + auth.uid()
-- porque la app usa NextAuth (no Supabase Auth).
-- =============================================================

-- stores: lectura anon (browser necesita listar tiendas)
alter table public.stores enable row level security;
create policy "anon_select_stores" on public.stores
  for select to anon using (true);

-- shift_logs: full CRUD anon (mismo patrón que activity_entries)
alter table public.shift_logs enable row level security;
create policy "anon_select_shift_logs" on public.shift_logs
  for select to anon using (true);
create policy "anon_insert_shift_logs" on public.shift_logs
  for insert to anon with check (true);
create policy "anon_update_shift_logs" on public.shift_logs
  for update to anon using (true);
create policy "anon_delete_shift_logs" on public.shift_logs
  for delete to anon using (true);

-- push_subscriptions: full CRUD anon
alter table public.push_subscriptions enable row level security;
create policy "anon_select_push_subscriptions" on public.push_subscriptions
  for select to anon using (true);
create policy "anon_insert_push_subscriptions" on public.push_subscriptions
  for insert to anon with check (true);
create policy "anon_update_push_subscriptions" on public.push_subscriptions
  for update to anon using (true);
create policy "anon_delete_push_subscriptions" on public.push_subscriptions
  for delete to anon using (true);

-- geofence_alerts: select + insert + update anon
alter table public.geofence_alerts enable row level security;
create policy "anon_select_geofence_alerts" on public.geofence_alerts
  for select to anon using (true);
create policy "anon_insert_geofence_alerts" on public.geofence_alerts
  for insert to anon with check (true);
create policy "anon_update_geofence_alerts" on public.geofence_alerts
  for update to anon using (true);

-- ── Realtime: habilitar broadcast de cambios para shift_logs y geofence_alerts ──
alter publication supabase_realtime add table shift_logs, geofence_alerts;

-- ── Ampliar CHECK constraint de admin_notifications para incluir geofence_alert ──
alter table public.admin_notifications drop constraint if exists admin_notifications_type_check;
alter table public.admin_notifications add constraint admin_notifications_type_check
  check (type in ('password_reset','password_change','user_deactivated','user_activated','daily_summary','geofence_alert'));
