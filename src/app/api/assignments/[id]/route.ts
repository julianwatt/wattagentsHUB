import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';
import { sendPushToUser } from '@/lib/push';
import { canManageAssignments } from '@/lib/permissions';
import {
  computeEffectiveMs,
  type AssignmentEvent,
  type GeofenceEventType,
} from '@/lib/assignmentGeofence';

const noCache = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

/**
 * PATCH /api/assignments/[id]
 *
 * Body: { action: 'accept' | 'reject' | 'cancel', rejection_reason?: string }
 *
 *  - accept / reject : Only the target agent, only while status === 'pending'.
 *                      On reject the optional reason is stored.
 *  - cancel          : Only CEO/Admin (canManageAssignments). Allowed from
 *                      any non-terminal status.
 *
 * State changes fan out an admin_notifications row + push:
 *  - accept/reject  → notifies the assigner about the agent's response
 *  - cancel         → notifies the agent that the CEO cancelled
 */
const TERMINAL_STATUSES = new Set([
  'completed', 'incomplete', 'cancelled', 'cancelled_in_progress', 'rejected', 'replaced',
]);
// Statuses that mean "already cancelled by an admin" — used for the
// idempotency check so a double-click doesn't overwrite cancelled_at and
// doesn't fan out a second notification to the agent.
const CANCELLED_STATUSES = new Set(['cancelled', 'cancelled_in_progress']);

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const action: string | undefined = body?.action;
  const rejection_reason: string | undefined =
    typeof body?.rejection_reason === 'string' ? body.rejection_reason.trim().slice(0, 500) : undefined;

  if (action !== 'accept' && action !== 'reject' && action !== 'cancel') {
    return NextResponse.json(
      { error: 'action must be "accept", "reject" or "cancel"' },
      { status: 400 },
    );
  }

  // Fetch the assignment + joined references for notification copy.
  // expected_duration_min is needed to compute met_duration when the cancel
  // flow has to freeze the in_progress shift's tally.
  const { data: assignment, error: fetchErr } = await supabase
    .from('assignments')
    .select(`
      id, agent_id, assigned_by, store_id, shift_date,
      scheduled_start_time, expected_duration_min, status,
      actual_entry_at,
      store:stores ( id, name )
    `)
    .eq('id', id)
    .single();

  if (fetchErr || !assignment) {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  }

  const storeName = (assignment.store as unknown as { name?: string } | null)?.name ?? '—';

  // ────────────────────────────────────────────────────────────────────────
  // Branch 1: agent accept / reject
  // ────────────────────────────────────────────────────────────────────────
  if (action === 'accept' || action === 'reject') {
    if (assignment.agent_id !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (assignment.status !== 'pending') {
      return NextResponse.json(
        { error: 'invalid_state', message: `Assignment is ${assignment.status}, no longer pending` },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const newStatus = action === 'accept' ? 'accepted' : 'rejected';
    const { error: updateErr } = await supabase
      .from('assignments')
      .update({
        status: newStatus,
        agent_response_at: now,
        rejection_reason: action === 'reject' ? rejection_reason || null : null,
      })
      .eq('id', id)
      .eq('status', 'pending'); // optimistic concurrency

    if (updateErr) {
      console.error('[assignments PATCH] update error:', updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    console.info(
      `[assignments PATCH] id=${id} agent=${session.user.id} action=${action}` +
        (rejection_reason ? ` reason="${rejection_reason}"` : ''),
    );

    // Fan out to assigner: in-app notification + push
    const { data: agentRow } = await supabase
      .from('users')
      .select('name, username')
      .eq('id', session.user.id)
      .single();
    const agentName = agentRow?.name ?? session.user.name ?? '—';
    const agentUsername = agentRow?.username ?? '—';

    const notifType = action === 'accept' ? 'assignment_accepted' : 'assignment_rejected';
    const adminNotifData: Record<string, unknown> = {
      actor_name: agentName,
      assignment_id: id,
      store_name: storeName,
      shift_date: assignment.shift_date,
      scheduled_start_time: assignment.scheduled_start_time,
    };
    if (action === 'reject' && rejection_reason) {
      adminNotifData.rejection_reason = rejection_reason;
    }

    const { error: notifErr } = await supabase.from('admin_notifications').insert({
      type: notifType,
      user_id: session.user.id,
      user_name: agentName,
      user_username: agentUsername,
      data: adminNotifData,
      status: 'pending',
    });
    if (notifErr) console.error('[assignments PATCH] admin_notifications insert error:', notifErr);

    if (assignment.assigned_by) {
      const title = action === 'accept'
        ? `✅ ${agentName} aceptó la asignación`
        : `❌ ${agentName} rechazó la asignación — requiere reasignación`;
      const pushBody = action === 'accept'
        ? `${storeName} · ${assignment.shift_date} · ${assignment.scheduled_start_time}`
        : rejection_reason
          ? `Motivo: ${rejection_reason}`
          : `${storeName} · ${assignment.shift_date} · ${assignment.scheduled_start_time}`;

      try {
        const pushResult = await sendPushToUser(
          assignment.assigned_by,
          { title, body: pushBody, url: '/assignments/today' },
          notifType,
        );
        console.info(
          `[assignments PATCH] push to assigner=${assignment.assigned_by} sent=${pushResult.sent}` +
            (pushResult.error ? ` error=${pushResult.error}` : ''),
        );
      } catch (err) {
        console.error('[assignments PATCH] push error (non-fatal):', err);
      }
    }

    return NextResponse.json({ ok: true, status: newStatus }, { headers: noCache });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Branch 2: CEO/Admin cancel — STRICT INVARIANTS
  //   - The UPDATE only ever runs against `id = $1` (the one row identified
  //     by the URL param). It never touches any other assignment, agent,
  //     or store. Verified: this branch contains exactly one .update().eq('id', id).
  //   - It does NOT insert into assignment_geofence_events. Cancellation is
  //     a separate flow from a real perimeter exit; the two share no code.
  //   - It does NOT call into computeCompliance or any geofence-detection
  //     code that could fan out to other rows.
  //   - It is idempotent: re-cancelling an already-cancelled assignment
  //     short-circuits with a 200 and does NOT overwrite cancelled_at,
  //     cancelled_by, effective_minutes, or fan out a second notification.
  // ────────────────────────────────────────────────────────────────────────
  if (!canManageAssignments(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Idempotency: already cancelled by an admin → return success without
  // touching the row. A double-click in the UI no longer rewrites
  // cancelled_at or sends a second push.
  if (CANCELLED_STATUSES.has(assignment.status)) {
    console.info(
      `[assignments PATCH cancel] id=${id} agent=${assignment.agent_id} `
      + `idempotent — already ${assignment.status}, no-op`,
    );
    return NextResponse.json(
      { ok: true, id, status: assignment.status, idempotent: true },
      { headers: noCache },
    );
  }

  // Other terminal states (completed/incomplete/rejected/replaced): cannot
  // be cancelled retroactively. Surface a clear 409.
  if (TERMINAL_STATUSES.has(assignment.status)) {
    return NextResponse.json(
      { error: 'invalid_state', message: `Assignment is already ${assignment.status}` },
      { status: 409 },
    );
  }

  const nowDate = new Date();
  const now = nowDate.toISOString();

  // wasActive = the agent already arrived at the perimeter. The only signal
  // we trust is `actual_entry_at` being non-null on a non-terminal row —
  // status alone is ambiguous because in_progress can race with cancel.
  const wasActive = assignment.actual_entry_at !== null;
  const newStatus = wasActive ? 'cancelled_in_progress' : 'cancelled';

  const updatePayload: Record<string, unknown> = {
    status: newStatus,
    cancelled_at: now,
    cancelled_by: session.user.id,
  };

  if (wasActive) {
    // Read events ONLY for this assignment id. Used to compute the effective
    // time at the moment of cancellation; never inserts new events.
    const { data: evRows } = await supabase
      .from('assignment_geofence_events')
      .select('event_type, occurred_at')
      .eq('assignment_id', id)
      .order('occurred_at', { ascending: true });
    const evs = ((evRows ?? []) as { event_type: GeofenceEventType; occurred_at: string }[])
      .map<AssignmentEvent>((e) => ({ event_type: e.event_type, occurred_at: e.occurred_at }));
    const effMs = computeEffectiveMs(evs, nowDate);
    const effMin = Math.floor(effMs / 60000);
    updatePayload.actual_exit_at = now;
    updatePayload.effective_minutes = effMin;
    updatePayload.met_duration = effMin >= assignment.expected_duration_min;
  }

  // The single mutation. Note `.eq('id', id)` — this is the ONLY filter on
  // the UPDATE. No agent_id, no store_id, no shift_date filter ever appears
  // here. If a future change adds another filter to this UPDATE, that's a
  // bug — keep the surface minimal so cross-row contamination is impossible.
  const { error: cancelErr } = await supabase
    .from('assignments')
    .update(updatePayload)
    .eq('id', id);

  if (cancelErr) {
    console.error('[assignments PATCH cancel] error:', cancelErr);
    return NextResponse.json({ error: cancelErr.message }, { status: 500 });
  }

  // Audit log: id, agent, ceo, prev→new status, eff minutes if applicable.
  // This is the trail to investigate any future "ghost cancellation" claim.
  console.info(
    `[assignments PATCH cancel] id=${id} agent=${assignment.agent_id} `
    + `by=${session.user.id} prev=${assignment.status} → ${newStatus}`
    + (wasActive ? ` effective_minutes=${updatePayload.effective_minutes}` : ''),
  );

  // Notify the agent
  const { data: ceoRow } = await supabase
    .from('users')
    .select('name, username')
    .eq('id', session.user.id)
    .single();
  const ceoName = ceoRow?.name ?? session.user.name ?? '—';

  await supabase.from('user_notifications').insert({
    recipient_user_id: assignment.agent_id,
    type: 'assignment_cancelled',
    title: '🚫 Asignación cancelada',
    body: `${ceoName} canceló tu asignación de ${storeName} · ${assignment.shift_date} · ${assignment.scheduled_start_time}.`,
    data: {
      assignment_id: id,
      store_name: storeName,
      shift_date: assignment.shift_date,
      scheduled_start_time: assignment.scheduled_start_time,
      cancelled_by_name: ceoName,
    },
    status: 'pending',
  });

  try {
    const pushResult = await sendPushToUser(
      assignment.agent_id,
      {
        title: '🚫 Asignación cancelada',
        body: `${storeName} · ${assignment.shift_date} · ${assignment.scheduled_start_time}`,
        url: '/home',
      },
      'assignment_cancelled',
    );
    console.info(
      `[assignments PATCH cancel] push to agent=${assignment.agent_id} sent=${pushResult.sent}` +
        (pushResult.error ? ` error=${pushResult.error}` : ''),
    );
  } catch (err) {
    console.error('[assignments PATCH cancel] push error (non-fatal):', err);
  }

  // Echo the id back so the client can confirm it cancelled the right row.
  return NextResponse.json(
    { ok: true, id, status: newStatus },
    { headers: noCache },
  );
}
