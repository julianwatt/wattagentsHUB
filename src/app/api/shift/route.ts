import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';

// GET — check if the user (or a given userId) has an active shift today
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  // Admin/CEO can query any user's shift
  const isPrivileged = session.user.role === 'admin' || session.user.role === 'ceo';
  const userId = (isPrivileged && searchParams.get('userId')) || session.user.id;

  const todayStr = new Date().toISOString().split('T')[0];

  // Fetch today's shift events for this user, ordered chronologically
  const { data: events, error } = await supabase
    .from('shift_logs')
    .select('*, stores(id, name, address, latitude, longitude, geofence_radius_meters)')
    .eq('user_id', userId)
    .gte('event_time', `${todayStr}T00:00:00`)
    .lt('event_time', `${todayStr}T23:59:59.999`)
    .order('event_time', { ascending: true });

  if (error) {
    console.error('[shift GET] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!events || events.length === 0) {
    return NextResponse.json({ active: false, events: [], store: null });
  }

  // A shift is active if there's a clock_in without a corresponding clock_out
  const hasClockedIn = events.some((e) => e.event_type === 'clock_in');
  const hasClockedOut = events.some((e) => e.event_type === 'clock_out');
  const active = hasClockedIn && !hasClockedOut;

  // Get the store from the clock_in event
  const clockInEvent = events.find((e) => e.event_type === 'clock_in');
  const store = clockInEvent?.stores ?? null;

  return NextResponse.json({ active, events, store });
}
