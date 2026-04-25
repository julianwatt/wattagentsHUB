import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';
import { checkGeofence, fmtDistance } from '@/lib/geo';
import { sendPushToUser } from '@/lib/push';
import { getT } from '@/lib/i18n';

// POST — register a shift event (clock_in, lunch_start, lunch_end, clock_out)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { storeId, eventType, latitude, longitude, geoMethod } = await req.json();

  if (!storeId || !eventType) {
    return NextResponse.json({ error: 'storeId and eventType required' }, { status: 400 });
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

  // Geofence check (only if coordinates provided)
  const hasCoords = latitude != null && longitude != null && (latitude !== 0 || longitude !== 0);
  const geo = hasCoords
    ? checkGeofence(latitude, longitude, store.latitude, store.longitude, store.geofence_radius_meters)
    : null;

  // Insert shift event
  const { data: event, error: insertErr } = await supabase
    .from('shift_logs')
    .insert({
      user_id: session.user.id,
      store_id: storeId,
      event_type: eventType,
      latitude: hasCoords ? latitude : null,
      longitude: hasCoords ? longitude : null,
      is_at_location: geo?.isInside ?? null,
      distance_meters: geo?.distanceMeters ?? null,
      geo_method: geoMethod || null,
    })
    .select('*')
    .single();

  if (insertErr) {
    console.error('[shift/event] insert error:', insertErr);
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  console.info(`[shift/event] saved id=${event.id} user=${session.user.id} type=${eventType} store=${store.id}`);

  // Always notify CEO for every shift event (never block event registration).
  // Outside-perimeter events get an additional high-priority geofence alert.
  try {
    await notifyShiftEvent(
      session.user.id,
      session.user.name || '—',
      eventType,
      store,
      geo,
      event.id,
    );
  } catch (err) {
    console.error('[shift/event] notify error (event was saved):', err);
  }

  return NextResponse.json({
    event,
    geofence: geo
      ? { isInside: geo.isInside, distanceMeters: geo.distanceMeters, radiusMeters: store.geofence_radius_meters }
      : null,
  }, { status: 201 });
}

// ── Notify CEO of every shift event (push + in-app notification) ──
// Outside-perimeter events also generate a geofence alert with higher priority.
async function notifyShiftEvent(
  agentUserId: string,
  agentName: string,
  eventType: string,
  store: { id: string; name: string },
  geo: { isInside: boolean; distanceMeters: number } | null,
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

  const t = getT('es');
  const eventLabelKeys: Record<string, string> = {
    clock_in: 'shift.clockIn',
    lunch_start: 'shift.lunchStart',
    lunch_end: 'shift.lunchEnd',
    clock_out: 'shift.clockOut',
  };
  const eventLabel = t(eventLabelKeys[eventType] || eventType);

  // Find CEO user
  const { data: ceo } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'ceo')
    .eq('is_active', true)
    .single();

  const isOutside = geo !== null && !geo.isInside;

  // Insert geofence alert only when outside perimeter
  if (isOutside) {
    await supabase.from('geofence_alerts').insert({
      user_id: agentUserId,
      store_id: store.id,
      alert_type: 'location_mismatch',
      latitude: null,
      longitude: null,
      distance_meters: geo!.distanceMeters,
      shift_log_id: shiftLogId,
    });
  }

  // Build push title/body — different urgency for outside vs inside
  const eventEmoji: Record<string, string> = {
    clock_in: '🟢', lunch_start: '⏳', lunch_end: '🔄', clock_out: '🔴',
  };
  const emoji = eventEmoji[eventType] || '⏺';

  const title = isOutside
    ? `⚠️ ${t('shift.pushOutsideTitle')}`
    : `${emoji} ${eventLabel}`;
  const body = isOutside
    ? t('shift.pushOutsideBody').replace('{name}', name).replace('{event}', eventLabel).replace('{dist}', fmtDistance(geo!.distanceMeters)).replace('{store}', store.name)
    : `${name} · ${store.name}`;

  // In-app notification (bell) — only for outside-perimeter alerts to avoid noise.
  // Regular shift events get a push to the CEO but no entry in the bell.
  if (isOutside) {
    const { error: notifErr } = await supabase.from('admin_notifications').insert({
      type: 'geofence_alert',
      user_id: agentUserId,
      user_name: name,
      user_username: username,
      data: {
        alert_type: 'location_mismatch',
        event_type: eventType,
        store_name: store.name,
        distance_meters: geo!.distanceMeters,
        shift_log_id: shiftLogId,
      },
      status: 'pending',
    });
    if (notifErr) console.error('[notifyShiftEvent] admin_notifications insert error:', notifErr);
  }

  // Push to CEO for EVERY shift event (logged unconditionally in lib/push.ts)
  if (ceo) {
    const result = await sendPushToUser(ceo.id, {
      title,
      body,
      url: isOutside ? '/notifications' : '/notifications',
    }, isOutside ? 'geofence_alert' : 'shift_event');
    console.info(`[notifyShiftEvent] push to CEO ceo=${ceo.id} agent=${agentUserId} event=${eventType} sent=${result.sent}${result.error ? ` error=${result.error}` : ''}`);
  } else {
    console.warn(`[notifyShiftEvent] no active CEO found — push skipped agent=${agentUserId} event=${eventType}`);
  }
}
