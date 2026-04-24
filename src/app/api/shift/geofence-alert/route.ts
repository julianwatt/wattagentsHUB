import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';
import { checkGeofence, fmtDistance } from '@/lib/geo';
import { sendPushToUser } from '@/lib/push';
import { getT } from '@/lib/i18n';

// POST — report that the agent left the perimeter during an active shift
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { storeId, latitude, longitude, shiftLogId } = await req.json();

  if (!storeId || latitude == null || longitude == null) {
    return NextResponse.json({ error: 'storeId, latitude, longitude required' }, { status: 400 });
  }

  // Fetch store
  const { data: store, error: storeErr } = await supabase
    .from('stores')
    .select('id, name, latitude, longitude, geofence_radius_meters')
    .eq('id', storeId)
    .single();

  if (storeErr || !store) {
    return NextResponse.json({ error: 'Store not found' }, { status: 404 });
  }

  // Verify the user is indeed outside
  const geo = checkGeofence(
    latitude, longitude,
    store.latitude, store.longitude,
    store.geofence_radius_meters,
  );

  if (geo.isInside) {
    return NextResponse.json({ alert: false, message: 'User is within perimeter' });
  }

  // Get agent info
  const { data: agent } = await supabase
    .from('users')
    .select('name, username')
    .eq('id', session.user.id)
    .single();

  const name = agent?.name || session.user.name || '—';
  const username = agent?.username || '—';

  // Insert geofence alert
  const { data: alert, error: alertErr } = await supabase
    .from('geofence_alerts')
    .insert({
      user_id: session.user.id,
      store_id: store.id,
      alert_type: 'outside_perimeter',
      latitude,
      longitude,
      distance_meters: geo.distanceMeters,
      shift_log_id: shiftLogId || null,
    })
    .select('*')
    .single();

  if (alertErr) {
    console.error('[geofence-alert] insert error:', alertErr);
    return NextResponse.json({ error: alertErr.message }, { status: 500 });
  }

  const t = getT('es');
  const title = `🚨 ${t('shift.pushContinuousTitle')}`;
  const body = t('shift.pushContinuousBody').replace('{name}', name).replace('{store}', store.name).replace('{dist}', fmtDistance(geo.distanceMeters));

  // In-app notification
  const { error: notifErr } = await supabase.from('admin_notifications').insert({
    type: 'geofence_alert',
    user_id: session.user.id,
    user_name: name,
    user_username: username,
    data: {
      alert_type: 'outside_perimeter',
      store_name: store.name,
      distance_meters: geo.distanceMeters,
      shift_log_id: shiftLogId || null,
    },
    status: 'pending',
  });
  if (notifErr) console.error('[geofence-alert] admin_notifications insert error:', notifErr);

  // Push notification to CEO
  const { data: ceo } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'ceo')
    .eq('is_active', true)
    .single();

  if (ceo) {
    await sendPushToUser(ceo.id, {
      title,
      body,
      url: '/notifications',
    });
  }

  return NextResponse.json({ alert: true, data: alert, distanceMeters: geo.distanceMeters }, { status: 201 });
}
