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
import { isCancelled, isTerminal } from '@/lib/assignmentStatus';

const noCache = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

/**
 * PATCH /api/assignments/[id]
 *
 * Body: { action: 'accept' | 'reject' | 'cancel' | 'reopen', rejection_reason?: string }
 *
 *  - accept / reject : Only the target agent, only while status === 'pending'.
 *                      On reject the optional reason is stored.
 *  - cancel          : Only CEO/Admin (canManageAssignments). For NON-terminal
 *                      rows (pending/accepted/in_progress). Sets status to
 *                      'cancelled' or 'cancelled_in_progress' depending on
 *                      whether the agent had already arrived.
 *  - reopen          : Only CEO/Admin. For terminal-by-closure rows
 *                      (incomplete/completed). Flips them to
 *                      'cancelled_in_progress' so the agent's slot for the
 *                      day is freed up for re-assignment, while preserving
 *                      actual_entry_at / effective_minutes / met_duration /
 *                      punctuality (the agent keeps credit for time worked).
 *                      Distinct from cancel — different source-status set
 *                      and different mutation surface.
 *
 * State changes fan out an admin_notifications row + push:
 *  - accept/reject  → notifies the assigner about the agent's response
 *  - cancel         → notifies the agent that the CEO cancelled
 *  - reopen         → notifies the agent that the CEO reopened the slot
 */
// Status taxonomy lives in lib/assignmentStatus — predicates `isTerminal`
// and `isCancelled` capture the sets used here. Re-exporting locally would
// just be duplication.

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const action: string | undefined = body?.action;
  const rejection_reason: string | undefined =
    typeof body?.rejection_reason === 'string' ? body.rejection_reason.trim().slice(0, 500) : undefined;

  if (action !== 'accept' && action !== 'reject' && action !== 'cancel' && action !== 'reopen') {
    return NextResponse.json(
      { error: 'action must be "accept", "reject", "cancel" or "reopen"' },
      { status: 400 },
    );
  }

  // Fetch the assignment + joined references for notification copy.
  // expected_duration_min is needed to compute met_duration when the cancel
  // flow has to freeze the in_progress shift's tally. effective_minutes is
  // surfaced by the reopen branch for audit logging (the value is preserved
  // through reopen — no re-computation).
  const { data: assignment, error: fetchErr } = await supabase
    .from('assignments')
    .select(`
      id, agent_id, assigned_by, store_id, shift_date,
      scheduled_start_time, expected_duration_min, status,
      actual_entry_at, effective_minutes,
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
  // Branches 2 & 3 (cancel / reopen) — both are admin-only.
  // ────────────────────────────────────────────────────────────────────────
  if (!canManageAssignments(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (action === 'cancel') {
    return await handleCancel({ id, assignment, storeName, session });
  }
  // action === 'reopen'
  return await handleReopen({ id, assignment, storeName, session });
}

// ──────────────────────────────────────────────────────────────────────────────
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
//   - Source-status set: pending / accepted / in_progress. For terminal-by-
//     closure rows (incomplete/completed), use the `reopen` action instead.
// ──────────────────────────────────────────────────────────────────────────────
interface AdminBranchArgs {
  id: string;
  assignment: {
    id: string; agent_id: string; assigned_by: string; store_id: string;
    shift_date: string; scheduled_start_time: string;
    expected_duration_min: number; status: string;
    actual_entry_at: string | null;
    effective_minutes: number;
    store: unknown;
  };
  storeName: string;
  session: { user: { id: string; name?: string | null } };
}

async function handleCancel(args: AdminBranchArgs) {
  const { id, assignment, storeName, session } = args;

  // Idempotency: already cancelled by an admin → return success without
  // touching the row. A double-click in the UI no longer rewrites
  // cancelled_at or sends a second push.
  if (isCancelled(assignment.status)) {
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
  if (isTerminal(assignment.status)) {
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

// ──────────────────────────────────────────────────────────────────────────────
// Branch 3: CEO/Admin reopen — for terminal-by-closure rows
//   Distinct from cancel: the source-status set is incomplete/completed
//   (rows already terminated by the geofence auto-close flow), and the
//   intent is to free the agent's day-slot so a new assignment can be
//   created.
//
//   Business rules:
//     1. Reopen ONLY applies to incomplete/completed rows. For pending,
//        accepted, or in_progress rows, the caller must use the cancel
//        action (those are still mutable and have their own lifecycle).
//     2. Preserves the agent's audit + work credit. actual_entry_at,
//        actual_exit_at, effective_minutes, met_duration, punctuality are
//        ALL untouched. The agent keeps the historical record of having
//        worked X minutes.
//     3. Frees the day-slot. Status flips to 'cancelled_in_progress',
//        which the partial-unique index excludes, allowing a fresh
//        assignment for the same (agent, shift_date) without violating
//        the constraint.
//     4. Idempotent on rows already in 'cancelled_in_progress' (200 + flag,
//        no re-stamp of cancelled_at, no second notification).
//     5. The UPDATE only ever runs against `id = $1`. NEVER touches
//        assignment_geofence_events.
// ──────────────────────────────────────────────────────────────────────────────
async function handleReopen(args: AdminBranchArgs) {
  const { id, assignment, storeName, session } = args;

  // Idempotency: row is already in the post-reopen state. No-op success.
  if (assignment.status === 'cancelled_in_progress') {
    console.info(
      `[assignments PATCH reopen] id=${id} agent_id=${assignment.agent_id} `
      + `idempotent — already cancelled_in_progress, no-op`,
    );
    return NextResponse.json(
      { ok: true, id, status: assignment.status, idempotent: true, reopened: true },
      { headers: noCache },
    );
  }

  // Reopen is for terminal-by-closure rows only. Surface targeted error
  // messages for each off-domain status so the UI can guide the user to
  // the correct action.
  if (assignment.status === 'pending' || assignment.status === 'accepted') {
    return NextResponse.json(
      {
        error: 'invalid_state',
        message: 'Para asignaciones pendientes o aceptadas usa la acción "cancelar".',
      },
      { status: 409 },
    );
  }
  if (assignment.status === 'in_progress') {
    return NextResponse.json(
      {
        error: 'invalid_state',
        message: 'El agente sigue activo en su turno. Usa "cancelar" en lugar de reabrir.',
      },
      { status: 409 },
    );
  }
  if (assignment.status !== 'incomplete' && assignment.status !== 'completed') {
    return NextResponse.json(
      {
        error: 'invalid_state',
        message: `Estado "${assignment.status}" no es reabrible.`,
      },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const prevStatus = assignment.status;

  // Mutation surface: only the 3 status/cancellation columns change.
  // EVERYTHING ELSE about the row stays exactly as it was — that's the
  // whole point of reopen vs cancel-then-recreate. The agent's worked
  // minutes are preserved as audit + payroll credit.
  const updatePayload: Record<string, unknown> = {
    status: 'cancelled_in_progress',
    cancelled_at: now,
    cancelled_by: session.user.id,
  };

  // Single-row UPDATE, by id only. Same invariant as the cancel branch:
  // no other filter ever appears here.
  const { error: reopenErr } = await supabase
    .from('assignments')
    .update(updatePayload)
    .eq('id', id);

  if (reopenErr) {
    console.error('[assignments PATCH reopen] error:', reopenErr);
    return NextResponse.json({ error: reopenErr.message }, { status: 500 });
  }

  // Audit log — captures preserved effective_minutes so the operator
  // trail makes the "agent kept credit" property visible.
  console.info(
    `[assignments PATCH reopen] id=${id} agent_id=${assignment.agent_id} `
    + `prev_status=${prevStatus} new_status=cancelled_in_progress `
    + `reopened_by=${session.user.id} `
    + `preserved_effective_minutes=${assignment.effective_minutes}`,
  );

  // Notify the agent — different copy than cancel since the row is being
  // re-opened (not cancelled outright); the agent keeps their work credit.
  const { data: ceoRow } = await supabase
    .from('users')
    .select('name, username')
    .eq('id', session.user.id)
    .single();
  const ceoName = ceoRow?.name ?? session.user.name ?? '—';

  await supabase.from('user_notifications').insert({
    recipient_user_id: assignment.agent_id,
    type: 'assignment_cancelled',
    title: '🔄 Asignación reabierta',
    body: `${ceoName} reabrió tu asignación de ${storeName} · ${assignment.shift_date} · ${assignment.scheduled_start_time}. Tu tiempo trabajado se conserva.`,
    data: {
      assignment_id: id,
      store_name: storeName,
      shift_date: assignment.shift_date,
      scheduled_start_time: assignment.scheduled_start_time,
      cancelled_by_name: ceoName,
      reopened: true,
      preserved_effective_minutes: assignment.effective_minutes,
    },
    status: 'pending',
  });

  try {
    const pushResult = await sendPushToUser(
      assignment.agent_id,
      {
        title: '🔄 Asignación reabierta',
        body: `${storeName} · ${assignment.shift_date} · ${assignment.scheduled_start_time}`,
        url: '/home',
      },
      'assignment_cancelled',
    );
    console.info(
      `[assignments PATCH reopen] push to agent=${assignment.agent_id} sent=${pushResult.sent}`
      + (pushResult.error ? ` error=${pushResult.error}` : ''),
    );
  } catch (err) {
    console.error('[assignments PATCH reopen] push error (non-fatal):', err);
  }

  return NextResponse.json(
    { ok: true, id, status: 'cancelled_in_progress', reopened: true },
    { headers: noCache },
  );
}
