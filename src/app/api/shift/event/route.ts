import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';
import { checkGeofence } from '@/lib/geo';
import { sendPushToUser } from '@/lib/push';

// POST — register a shift event (clock_in, lunch_start, lunch_end, clock_out)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { storeId, eventType, latitude, longitude } = await req.json();

  if (!storeId || !eventType || latitude == null || longitude == null) {
    return NextResponse.json({ error: 'storeId, eventType, latitude, longitude required' }, { status: 400 });
  }

  const validEvents = ['clock_in', 'lunch_start', 'lunch_end', 'clock_out'];
  if (!validEvents.includes(eventType)) {
    return NextResponse.json({ error: `eventType must be one of: ${validEvents.join(', ')}` }, { status: 400 });
  }

  // Fetch store for geofence check
  const { data: store, error: storeErr } = await supabase
    .from('stores')
    .select('id, name, latitude, longitude, geofence_radius_meters')
    .eq('id', storeId)
    .single();

  if (storeErr || !store) {
    return NextResponse.json({ error: 'Store not found' }, { status: 404 });
  }

  // Geofence check
  const geo = checkGeofence(
    latitude, longitude,
    store.latitude, store.longitude,
    store.geofence_radius_meters,
  );

  // Insert shift event
  const { data: event, error: insertErr } = await supabase
    .from('shift_logs')
    .insert({
      user_id: session.user.id,
      store_id: storeId,
      event_type: eventType,
      latitude,
      longitude,
      is_at_location: geo.isInside,
      distance_meters: geo.distanceMeters,
    })
    .select('*')
    .single();

  if (insertErr) {
    console.error('[shift/event] insert error:', insertErr);
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // If outside perimeter → alert CEO
  if (!geo.isInside) {
    await notifyCeo(session.user.id, session.user.name || '—', eventType, store, geo.distanceMeters, event.id);
  }

  return NextResponse.json({
    event,
    geofence: {
      isInside: geo.isInside,
      distanceMeters: geo.distanceMeters,
      radiusMeters: store.geofence_radius_meters,
    },
  }, { status: 201 });
}

// ── Notify CEO: push + in-app notification ──
async function notifyCeo(
  agentUserId: string,
  agentName: string,
  eventType: string,
  store: { id: string; name: string },
  distanceMeters: number,
  shiftLogId: string,
) {
  // Get agent username for notification
  const { data: agentData } = await supabase
    .from('users')
    .select('name, username')
    .eq('id', agentUserId)
    .single();

  const name = agentData?.name || agentName;
  const username = agentData?.username || '—';

  const eventLabels: Record<string, string> = {
    clock_in: 'Inicio de turno',
    lunch_start: 'Inicio de descanso',
    lunch_end: 'Regreso de descanso',
    clock_out: 'Fin de turno',
  };
  const eventLabel = eventLabels[eventType] || eventType;

  // Find CEO user
  const { data: ceo } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'ceo')
    .eq('is_active', true)
    .single();

  // Insert geofence alert
  await supabase.from('geofence_alerts').insert({
    user_id: agentUserId,
    store_id: store.id,
    alert_type: 'location_mismatch',
    latitude: null,
    longitude: null,
    distance_meters: distanceMeters,
    shift_log_id: shiftLogId,
  });

  const title = '⚠️ Fuera de perímetro';
  const body = `${name} registró "${eventLabel}" a ${distanceMeters}m de ${store.name}`;

  // In-app notification (admin_notifications)
  await supabase.from('admin_notifications').insert({
    type: 'geofence_alert',
    user_id: agentUserId,
    user_name: name,
    user_username: username,
    data: {
      event_type: eventType,
      store_name: store.name,
      distance_meters: distanceMeters,
      shift_log_id: shiftLogId,
    },
    status: 'pending',
  });

  // Push notification to CEO
  if (ceo) {
    await sendPushToUser(ceo.id, {
      title,
      body,
      url: '/notifications',
    });
  }
}
