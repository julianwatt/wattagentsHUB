import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';
import { canManageAssignments } from '@/lib/permissions';
import { localToday } from '@/lib/time';
import {
  computeEffectiveMs,
  type AssignmentEvent,
  type GeofenceEventType,
} from '@/lib/assignmentGeofence';

const noCache = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

interface RawAssignment {
  id: string;
  agent_id: string;
  assigned_by: string;
  store_id: string;
  shift_date: string;
  scheduled_start_time: string;
  expected_duration_min: number;
  status: string;
  actual_entry_at: string | null;
  actual_exit_at: string | null;
  effective_minutes: number;
  met_duration: boolean | null;
  punctuality: string | null;
  rejection_reason: string | null;
  agent_response_at: string | null;
  created_at: string;
  agent: { id: string; name: string; username: string } | null;
  assigner: { id: string; name: string } | null;
  store: { id: string; name: string; address: string | null; latitude: number; longitude: number } | null;
}

interface RawEvent {
  assignment_id: string;
  event_type: GeofenceEventType;
  occurred_at: string;
  distance_meters: number | null;
  latitude: number | null;
  longitude: number | null;
  geo_method: string | null;
}

/**
 * GET /api/assignments/today
 *
 * Returns every assignment with shift_date == today (server local date), with
 * each row enriched by:
 *   - last_event       : the most recent geofence event (for last-known distance)
 *   - effective_ms_now : effective time computed live from the events. For
 *                        in_progress this includes time since the last entered/
 *                        reentered event up to now.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManageAssignments(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const todayStr = localToday();

  // 1. Today's assignments with joined people + store. Exclude 'replaced' —
  //    those are historical rows superseded by a fresher one for the same
  //    (agent, day) and should never reach the live "Hoy" panel.
  const { data: aData, error: aErr } = await supabase
    .from('assignments')
    .select(`
      id, agent_id, assigned_by, store_id, shift_date,
      scheduled_start_time, expected_duration_min, status,
      actual_entry_at, actual_exit_at, effective_minutes,
      met_duration, punctuality, rejection_reason, agent_response_at,
      created_at,
      agent:users!assignments_agent_id_fkey ( id, name, username ),
      assigner:users!assignments_assigned_by_fkey ( id, name ),
      store:stores ( id, name, address, latitude, longitude )
    `)
    .eq('shift_date', todayStr)
    .neq('status', 'replaced')
    .order('scheduled_start_time', { ascending: true })
    .order('created_at', { ascending: true });

  if (aErr) {
    console.error('[assignments/today] error:', aErr);
    return NextResponse.json({ error: aErr.message }, { status: 500 });
  }

  const assignments = (aData ?? []) as unknown as RawAssignment[];
  if (assignments.length === 0) {
    return NextResponse.json({ assignments: [], serverNow: new Date().toISOString() }, { headers: noCache });
  }

  // 2. Pull all events for those assignments in one round-trip
  const ids = assignments.map((a) => a.id);
  const { data: eData } = await supabase
    .from('assignment_geofence_events')
    .select('assignment_id, event_type, occurred_at, distance_meters, latitude, longitude, geo_method')
    .in('assignment_id', ids)
    .order('occurred_at', { ascending: true });

  const events = (eData ?? []) as RawEvent[];

  // Bucket events by assignment_id for O(1) lookup
  const byAssignment = new Map<string, RawEvent[]>();
  for (const ev of events) {
    if (!byAssignment.has(ev.assignment_id)) byAssignment.set(ev.assignment_id, []);
    byAssignment.get(ev.assignment_id)!.push(ev);
  }

  const now = new Date();
  const enriched = assignments.map((a) => {
    const evs = byAssignment.get(a.id) ?? [];
    const last = evs.length > 0 ? evs[evs.length - 1] : null;
    const slim: AssignmentEvent[] = evs.map((e) => ({
      event_type: e.event_type,
      occurred_at: e.occurred_at,
    }));
    const liveNow = a.status === 'in_progress' ? now : new Date(a.actual_exit_at ?? now.toISOString());
    const effective_ms_now = computeEffectiveMs(slim, liveNow);

    return {
      ...a,
      last_event: last
        ? {
            event_type: last.event_type,
            occurred_at: last.occurred_at,
            distance_meters: last.distance_meters,
            latitude: last.latitude,
            longitude: last.longitude,
            geo_method: last.geo_method,
          }
        : null,
      effective_ms_now,
    };
  });

  return NextResponse.json(
    { assignments: enriched, serverNow: now.toISOString() },
    { headers: noCache },
  );
}
