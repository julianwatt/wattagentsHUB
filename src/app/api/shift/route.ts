import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';

// GET — return the user's current active shift (if any).
//
// "Current shift" = events strictly after the most recent clock_out, or all
// events of the last 36 hours if no clock_out has occurred. This handles:
//   - Multiple shifts in the same UTC day
//   - Shifts spanning UTC midnight
//   - Duplicate clock_in events created by previous reload bugs
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const isPrivileged = session.user.role === 'admin' || session.user.role === 'ceo';
  const userId = (isPrivileged && searchParams.get('userId')) || session.user.id;

  // Look back 36h to handle shifts crossing UTC midnight + safety margin
  const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();

  const { data: allEvents, error } = await supabase
    .from('shift_logs')
    .select('*, stores(id, name, address, latitude, longitude, geofence_radius_meters)')
    .eq('user_id', userId)
    .gte('event_time', since)
    .order('event_time', { ascending: true });

  if (error) {
    console.error('[shift GET] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const noCache = { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' };

  if (!allEvents || allEvents.length === 0) {
    return NextResponse.json({ active: false, events: [], store: null }, { headers: noCache });
  }

  // Find the index of the most recent clock_out
  let lastClockOutIdx = -1;
  for (let i = allEvents.length - 1; i >= 0; i--) {
    if (allEvents[i].event_type === 'clock_out') {
      lastClockOutIdx = i;
      break;
    }
  }

  // Current shift events = events strictly after the most recent clock_out
  const shiftEvents = lastClockOutIdx >= 0
    ? allEvents.slice(lastClockOutIdx + 1)
    : allEvents;

  if (shiftEvents.length === 0) {
    // Last action was a clock_out → no active shift
    return NextResponse.json({ active: false, events: [], store: null }, { headers: noCache });
  }

  // The shift is active (no clock_out in shiftEvents by construction).
  // Use the FIRST clock_in of the current shift as the canonical start
  // (subsequent clock_ins are duplicates from reload-induced state loss).
  const firstClockIn = shiftEvents.find((e) => e.event_type === 'clock_in');
  const store = firstClockIn?.stores ?? null;

  return NextResponse.json({ active: true, events: shiftEvents, store }, { headers: noCache });
}
