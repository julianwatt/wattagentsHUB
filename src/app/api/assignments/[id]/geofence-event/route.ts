import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';
import { sendPushToUser } from '@/lib/push';
import { fmtDistance, haversineMeters } from '@/lib/geo';
import {
  ringForDistance,
  eventTypeForTransition,
  computeEffectiveMs,
  computeCompliance,
  NOTIFICATION_DEBOUNCE_MS,
  type Ring,
  type GeofenceEventType,
  type AssignmentEvent,
} from '@/lib/assignmentGeofence';

const noCache = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

const VALID_GEO_METHODS = new Set(['gps_high', 'gps_low', 'ip']);

const PUSH_TYPE_BY_EVENT: Record<GeofenceEventType, string> = {
  entered:      'assignment_arrived',
  exited_warn:  'assignment_exited_warn',
  exited_final: 'assignment_exited_final',
  reentered:    'assignment_reentered',
};

const PUSH_TITLE_BY_EVENT: Record<GeofenceEventType, string> = {
  entered:      '✅ {agent} llegó a {store}',
  exited_warn:  '⚠️ {agent} salió temporalmente de {store}',
  exited_final: '🛑 {agent} terminó turno (salida >300m)',
  reentered:    '🔄 {agent} regresó a {store}',
};

/**
 * POST /api/assignments/[id]/geofence-event
 *
 * Body: { latitude, longitude, geo_method, current_ring?, previous_ring? }
 *
 * The endpoint:
 *  1. Verifies the assignment belongs to the agent and is in an active state.
 *  2. Computes the ring server-side from the user's coords + the store's
 *     coords (does NOT trust the client's `current_ring`).
 *  3. Looks up the LAST recorded event for this assignment (DB is the source
 *     of truth for previous ring, not the client).
 *  4. Decides which event_type to emit (or noop if no transition).
 *  5. Inserts the event row.
 *  6. Updates the assignment columns (status / actual_entry_at / actual_exit_at /
 *     effective_minutes / met_duration / punctuality) per the transition rules.
 *  7. Fires a push to the assigner with a 2-min debounce per event type.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: assignmentId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const latitude: number | undefined = body?.latitude;
  const longitude: number | undefined = body?.longitude;
  const geo_method: string = VALID_GEO_METHODS.has(body?.geo_method) ? body.geo_method : 'gps_low';

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return NextResponse.json({ error: 'latitude and longitude (numbers) required' }, { status: 400 });
  }

  // ── Load assignment + store + agent name (for push messages) ──────────────
  const { data: assignment, error: aErr } = await supabase
    .from('assignments')
    .select(`
      id, agent_id, assigned_by, store_id, shift_date,
      scheduled_start_time, expected_duration_min, status,
      actual_entry_at, actual_exit_at,
      store:stores ( id, name, latitude, longitude, geofence_radius_meters )
    `)
    .eq('id', assignmentId)
    .single();

  if (aErr || !assignment) {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  }
  if (assignment.agent_id !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!['accepted', 'in_progress'].includes(assignment.status)) {
    return NextResponse.json(
      { error: 'invalid_state', status: assignment.status, message: 'Assignment is not active' },
      { status: 409 },
    );
  }

  const store = assignment.store as unknown as
    | { id: string; name: string; latitude: number; longitude: number; geofence_radius_meters: number }
    | null;
  if (!store) {
    return NextResponse.json({ error: 'Store missing on assignment' }, { status: 500 });
  }

  // ── Compute ring server-side ──────────────────────────────────────────────
  const distance_meters = Math.round(
    haversineMeters(latitude, longitude, store.latitude, store.longitude),
  );
  // Pass geo_method so low-confidence readings get the wider 500m outer
  // threshold (see RING_OUTER_LOW_CONFIDENCE_M). Without this, a single
  // gps_low reading at 300–500m would auto-close the shift even though
  // the agent's true position is likely still within the warn ring.
  const currentRing: Ring = ringForDistance(distance_meters, geo_method);

  // ── Look up the last event to know previous ring ──────────────────────────
  const { data: lastEventRow } = await supabase
    .from('assignment_geofence_events')
    .select('event_type, occurred_at')
    .eq('assignment_id', assignmentId)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const previousRing: Ring | null = lastEventRow
    ? lastEventRowToRing(lastEventRow.event_type as GeofenceEventType)
    : null;

  const eventType = eventTypeForTransition(previousRing, currentRing);

  // No transition → just acknowledge with current state, no DB write.
  if (!eventType) {
    return NextResponse.json(
      {
        ok: true,
        recorded: false,
        ring: currentRing,
        previous_ring: previousRing,
        distance_meters,
      },
      { headers: noCache },
    );
  }

  const occurred_at = new Date().toISOString();

  // ── Insert event row ──────────────────────────────────────────────────────
  const { error: insertErr } = await supabase
    .from('assignment_geofence_events')
    .insert({
      assignment_id: assignmentId,
      event_type: eventType,
      occurred_at,
      latitude,
      longitude,
      distance_meters,
      geo_method,
    });

  if (insertErr) {
    console.error('[assignments geofence-event] insert error:', insertErr);
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  console.info(
    `[assignments geofence-event] id=${assignmentId} agent=${session.user.id} ` +
      `transition=${previousRing ?? '∅'}→${currentRing} event=${eventType} dist=${distance_meters}m`,
  );

  // ── Apply transition consequences to the assignments row ──────────────────
  const updates: Record<string, unknown> = {};

  if (eventType === 'entered') {
    // First-ever entry: stamp it, flip to in_progress
    if (!assignment.actual_entry_at) {
      updates.actual_entry_at = occurred_at;
    }
    if (assignment.status === 'accepted') {
      updates.status = 'in_progress';
    }
  }

  if (eventType === 'reentered') {
    // Coming back from outer or warn. If the assignment had previously been
    // closed (completed/incomplete) by a "exited_final" event, reopen it.
    if (assignment.status !== 'in_progress') {
      updates.status = 'in_progress';
    }
    // Clear actual_exit_at because the shift is no longer over.
    if (assignment.actual_exit_at) {
      updates.actual_exit_at = null;
    }
  }

  if (eventType === 'exited_final') {
    // Auto-end of shift. Compute compliance from the events (including the
    // one we just inserted).
    const allEvents = await fetchEvents(assignmentId);
    const compliance = computeCompliance({
      shift_date: assignment.shift_date,
      scheduled_start_time: assignment.scheduled_start_time,
      expected_duration_min: assignment.expected_duration_min,
      actual_entry_at: (updates.actual_entry_at as string | undefined) ?? assignment.actual_entry_at,
      events: allEvents,
      liveNow: new Date(occurred_at),
    });
    updates.actual_exit_at = occurred_at;
    updates.effective_minutes = compliance.effective_minutes;
    updates.met_duration = compliance.met_duration;
    updates.punctuality = compliance.punctuality;
    updates.status = compliance.met_duration ? 'completed' : 'incomplete';
  }

  if (eventType === 'exited_warn') {
    // Update effective_minutes snapshot (time PAUSES here). No status change.
    const allEvents = await fetchEvents(assignmentId);
    updates.effective_minutes = Math.floor(
      computeEffectiveMs(allEvents, new Date(occurred_at)) / 60000,
    );
  }

  if (Object.keys(updates).length > 0) {
    const { error: updErr } = await supabase
      .from('assignments')
      .update(updates)
      .eq('id', assignmentId);
    if (updErr) {
      console.error('[assignments geofence-event] update error:', updErr);
    }
  }

  // ── Push notification to assigner (with debounce) ────────────────────────
  await maybeNotifyAssigner({
    assignmentId,
    eventType,
    assignerId: assignment.assigned_by,
    agentId: session.user.id,
    storeName: store.name,
    distance_meters,
  });

  return NextResponse.json(
    {
      ok: true,
      recorded: true,
      event_type: eventType,
      ring: currentRing,
      previous_ring: previousRing,
      distance_meters,
      status: (updates.status as string | undefined) ?? assignment.status,
    },
    { headers: noCache },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Reverse-derive the agent's ring from the most recent event we recorded. */
function lastEventRowToRing(eventType: GeofenceEventType): Ring {
  switch (eventType) {
    case 'entered':
    case 'reentered':
      return 'inner';
    case 'exited_warn':
      return 'warn';
    case 'exited_final':
      return 'outer';
  }
}

async function fetchEvents(assignmentId: string): Promise<AssignmentEvent[]> {
  const { data, error } = await supabase
    .from('assignment_geofence_events')
    .select('event_type, occurred_at')
    .eq('assignment_id', assignmentId)
    .order('occurred_at', { ascending: true });
  if (error) {
    console.error('[fetchEvents] error', error);
    return [];
  }
  return (data ?? []) as AssignmentEvent[];
}

/**
 * Send a push to the assigner with a per-event-type debounce.
 *
 * Debounce rule: if an admin_notifications row of the same type for the same
 * assignment was inserted within the last NOTIFICATION_DEBOUNCE_MS, skip both
 * the in-app notif and the push.
 */
async function maybeNotifyAssigner(args: {
  assignmentId: string;
  eventType: GeofenceEventType;
  assignerId: string;
  agentId: string;
  storeName: string;
  distance_meters: number;
}) {
  const { assignmentId, eventType, assignerId, agentId, storeName, distance_meters } = args;
  const notifType = PUSH_TYPE_BY_EVENT[eventType];
  const cutoff = new Date(Date.now() - NOTIFICATION_DEBOUNCE_MS).toISOString();

  // Debounce: did we already notify the assigner for this same event-type
  // on this same assignment in the last 2 minutes?
  const { data: recent } = await supabase
    .from('admin_notifications')
    .select('id, created_at')
    .eq('type', notifType)
    .gte('created_at', cutoff)
    .contains('data', { assignment_id: assignmentId })
    .limit(1);

  if (recent && recent.length > 0) {
    console.info(
      `[geofence-event] debounced notif type=${notifType} assignment=${assignmentId}`,
    );
    return;
  }

  // Lookup agent display name
  const { data: agentRow } = await supabase
    .from('users')
    .select('name, username')
    .eq('id', agentId)
    .single();
  const agentName = agentRow?.name ?? '—';
  const agentUsername = agentRow?.username ?? '—';

  // In-app notification (CEO bell)
  const { error: notifErr } = await supabase.from('admin_notifications').insert({
    type: notifType,
    user_id: agentId,
    user_name: agentName,
    user_username: agentUsername,
    data: {
      assignment_id: assignmentId,
      store_name: storeName,
      distance_meters,
      event_type: eventType,
    },
    status: 'pending',
  });
  if (notifErr) {
    console.error('[geofence-event] admin_notifications insert error:', notifErr);
  }

  // Push
  const title = PUSH_TITLE_BY_EVENT[eventType]
    .replace('{agent}', agentName)
    .replace('{store}', storeName);
  const body =
    eventType === 'exited_warn' || eventType === 'exited_final'
      ? `Distancia: ${fmtDistance(distance_meters)}`
      : storeName;

  try {
    const result = await sendPushToUser(
      assignerId,
      { title, body, url: '/assignments/today' },
      notifType,
    );
    console.info(
      `[geofence-event] push to assigner=${assignerId} type=${notifType} sent=${result.sent}` +
        (result.error ? ` error=${result.error}` : ''),
    );
  } catch (err) {
    console.error('[geofence-event] push error (non-fatal):', err);
  }
}
