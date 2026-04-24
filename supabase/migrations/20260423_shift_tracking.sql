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
  geofence_radius_meters integer default 100,
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

-- ── SEED: Primera tienda ──
insert into public.stores (name, address, latitude, longitude, geofence_radius_meters)
values (
  'Watt Distributors Office – Irving',
  '4425 W Airport Fwy, Ste 145, Irving, TX 75062, United States',
  32.83867021079666,
  -97.01236531587371,
  100
);

-- =============================================================
-- RLS — Patrón existente: anon read-only, server bypasa con
-- service-role key. No se usa authenticated + auth.uid()
-- porque la app usa NextAuth (no Supabase Auth).
-- =============================================================

-- stores: lectura anon (browser necesita listar tiendas)
alter table public.stores enable row level security;
create policy "anon_select_stores" on public.stores
  for select to anon using (true);

-- shift_logs: lectura anon (realtime en dashboard)
alter table public.shift_logs enable row level security;
create policy "anon_select_shift_logs" on public.shift_logs
  for select to anon using (true);

-- push_subscriptions: sin acceso anon (server-only)
alter table public.push_subscriptions enable row level security;

-- geofence_alerts: lectura anon (realtime alertas en admin)
alter table public.geofence_alerts enable row level security;
create policy "anon_select_geofence_alerts" on public.geofence_alerts
  for select to anon using (true);
