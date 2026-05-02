import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';
import { canManageAssignments } from '@/lib/permissions';

const noCache = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

const STORE_SELECT = 'id, name, address, latitude, longitude, geofence_radius_meters, is_active, created_at';

// ──────────────────────────────────────────────────────────────────────────────
// GET — list every store (active + inactive). Used by the Tiendas admin tab.
// The assignment form uses /api/shift/stores which filters to active only.
// ──────────────────────────────────────────────────────────────────────────────
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManageAssignments(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('stores')
    .select(STORE_SELECT)
    .order('is_active', { ascending: false })
    .order('name', { ascending: true });

  if (error) {
    console.error('[stores GET] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ stores: data ?? [] }, { headers: noCache });
}

// ──────────────────────────────────────────────────────────────────────────────
// POST — create a new store. Body:
//   { name, address?, latitude, longitude, geofence_radius_meters? }
// ──────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManageAssignments(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const name: string | undefined = typeof body?.name === 'string' ? body.name.trim() : undefined;
  const address: string | null = typeof body?.address === 'string' ? body.address.trim() : null;
  const latitude: number | undefined = Number.isFinite(body?.latitude) ? Number(body.latitude) : undefined;
  const longitude: number | undefined = Number.isFinite(body?.longitude) ? Number(body.longitude) : undefined;
  const geofence_radius_meters: number =
    Number.isFinite(body?.geofence_radius_meters) && body.geofence_radius_meters > 0
      ? Math.floor(body.geofence_radius_meters)
      : 200;

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (latitude === undefined || longitude === undefined) {
    return NextResponse.json({ error: 'latitude and longitude are required' }, { status: 400 });
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return NextResponse.json({ error: 'latitude/longitude out of valid range' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('stores')
    .insert({
      name,
      address: address || null,
      latitude,
      longitude,
      geofence_radius_meters,
      is_active: true,
    })
    .select(STORE_SELECT)
    .single();

  if (error) {
    console.error('[stores POST] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.info(`[stores POST] created id=${data.id} name="${name}" by=${session.user.id}`);
  return NextResponse.json({ store: data }, { status: 201, headers: noCache });
}

// ──────────────────────────────────────────────────────────────────────────────
// PATCH — update store. Body: { id, ...patch }
// Allowed patch fields: name, address, latitude, longitude,
// geofence_radius_meters, is_active.
// ──────────────────────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManageAssignments(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { id, ...rest } = body ?? {};
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof rest.name === 'string') patch.name = rest.name.trim();
  if (typeof rest.address === 'string' || rest.address === null) patch.address = rest.address || null;
  if (Number.isFinite(rest.latitude)) patch.latitude = Number(rest.latitude);
  if (Number.isFinite(rest.longitude)) patch.longitude = Number(rest.longitude);
  if (Number.isFinite(rest.geofence_radius_meters) && rest.geofence_radius_meters > 0) {
    patch.geofence_radius_meters = Math.floor(rest.geofence_radius_meters);
  }
  if (typeof rest.is_active === 'boolean') patch.is_active = rest.is_active;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no valid fields to update' }, { status: 400 });
  }

  // Validate coord ranges if either is being patched. (Same rule as POST.)
  const newLat = patch.latitude as number | undefined;
  const newLng = patch.longitude as number | undefined;
  if (newLat !== undefined && (newLat < -90 || newLat > 90)) {
    return NextResponse.json({ error: 'latitude out of valid range' }, { status: 400 });
  }
  if (newLng !== undefined && (newLng < -180 || newLng > 180)) {
    return NextResponse.json({ error: 'longitude out of valid range' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('stores')
    .update(patch)
    .eq('id', id)
    .select(STORE_SELECT)
    .single();

  if (error) {
    console.error('[stores PATCH] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.info(`[stores PATCH] id=${id} keys=${Object.keys(patch).join(',')} by=${session.user.id}`);
  return NextResponse.json({ store: data }, { headers: noCache });
}
