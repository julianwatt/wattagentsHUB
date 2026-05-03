import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';
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

interface LiveRow {
  id: string;
  status: string;
  actual_exit_at: string | null;
}

interface RawEvent {
  assignment_id: string;
  event_type: GeofenceEventType;
  occurred_at: string;
  distance_meters: number | null;
  geo_method: string | null;
}

/**
 * GET /api/assignments/my
 *
 * Returns the current user's relevant assignments to drive the agent UI:
 *   - live              : pending / accepted / in_progress, for today onwards
 *   - recentRejected    : rejected within the last 24h with no live replacement
 *
 * Each `live` row is enriched with:
 *   - last_event        : most recent geofence event (for distance/sub-state)
 *   - effective_ms_now  : computeEffectiveMs() over the row's events at server now
 *
 * The agent-side AssignmentProgressCard uses these to show live progress.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;
  const todayStr = localToday();
  const yesterdayIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const baseSelect = `
    id, agent_id, assigned_by, store_id, shift_date,
    scheduled_start_time, expected_duration_min, status,
    actual_entry_at, actual_exit_at, effective_minutes,
    met_duration, punctuality, agent_response_at,
    rejection_reason, created_at, updated_at,
    assigner:users!assignments_assigned_by_fkey ( id, name ),
    store:stores ( id, name, address, latitude, longitude, geofence_radius_meters )
  `;

  const liveQ = supabase
    .from('assignments')
    .select(baseSelect)
    .eq('agent_id', userId)
    .gte('shift_date', todayStr)
    .in('status', ['pending', 'accepted', 'in_progress'])
    .order('shift_date', { ascending: true })
    .order('scheduled_start_time', { ascending: true });

  const rejectedQ = supabase
    .from('assignments')
    .select(baseSelect)
    .eq('agent_id', userId)
    .eq('status', 'rejected')
    .gte('agent_response_at', yesterdayIso)
    .order('agent_response_at', { ascending: false })
    .limit(1);

  const [liveRes, rejectedRes] = await Promise.all([liveQ, rejectedQ]);

  if (liveRes.error) {
    console.error('[assignments/my] live error:', liveRes.error);
    return NextResponse.json({ error: liveRes.error.message }, { status: 500 });
  }
  if (rejectedRes.error) {
    console.error('[assignments/my] rejected error:', rejectedRes.error);
    return NextResponse.json({ error: rejectedRes.error.message }, { status: 500 });
  }

  const live = (liveRes.data ?? []) as unknown as LiveRow[];
  const liveIds = live.map((a) => a.id);

  // Pull events for live assignments in one round-trip
  let eventsByAssignment = new Map<string, RawEvent[]>();
  if (liveIds.length > 0) {
    const { data: eData } = await supabase
      .from('assignment_geofence_events')
      .select('assignment_id, event_type, occurred_at, distance_meters, geo_method')
      .in('assignment_id', liveIds)
      .order('occurred_at', { ascending: true });

    eventsByAssignment = (eData ?? []).reduce((map, ev: RawEvent) => {
      if (!map.has(ev.assignment_id)) map.set(ev.assignment_id, []);
      map.get(ev.assignment_id)!.push(ev);
      return map;
    }, new Map<string, RawEvent[]>());
  }

  const now = new Date();
  const liveEnriched = live.map((a) => {
    const evs = eventsByAssignment.get(a.id) ?? [];
    const last = evs.length > 0 ? evs[evs.length - 1] : null;
    const slim: AssignmentEvent[] = evs.map((e) => ({
      event_type: e.event_type,
      occurred_at: e.occurred_at,
    }));
    const liveNow = a.status === 'in_progress' ? now : new Date(a.actual_exit_at ?? now.toISOString());
    return {
      ...(a as unknown as Record<string, unknown>),
      last_event: last
        ? {
            event_type: last.event_type,
            occurred_at: last.occurred_at,
            distance_meters: last.distance_meters,
            geo_method: last.geo_method,
          }
        : null,
      effective_ms_now: computeEffectiveMs(slim, liveNow),
    };
  });

  return NextResponse.json(
    {
      live: liveEnriched,
      recentRejected: rejectedRes.data ?? [],
      serverNow: now.toISOString(),
    },
    { headers: noCache },
  );
}
