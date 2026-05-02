import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';
import { sendPushToUser } from '@/lib/push';

const noCache = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

/**
 * PATCH /api/assignments/[id]
 *
 * Body: { action: 'accept' | 'reject', rejection_reason?: string }
 *
 * Only the assignment's target agent can accept or reject — and only while
 * the assignment is in `pending` status. Successful state changes fan out
 * an admin_notifications row + push to the assigner.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const action: string | undefined = body?.action;
  const rejection_reason: string | undefined =
    typeof body?.rejection_reason === 'string' ? body.rejection_reason.trim().slice(0, 500) : undefined;

  if (action !== 'accept' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be "accept" or "reject"' }, { status: 400 });
  }

  // Fetch the assignment + joined references for notification copy
  const { data: assignment, error: fetchErr } = await supabase
    .from('assignments')
    .select(`
      id, agent_id, assigned_by, store_id, shift_date,
      scheduled_start_time, status,
      store:stores ( id, name )
    `)
    .eq('id', id)
    .single();

  if (fetchErr || !assignment) {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  }

  // Authorisation: only the target agent can accept/reject their own assignment
  if (assignment.agent_id !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Status check — can only act while pending
  if (assignment.status !== 'pending') {
    return NextResponse.json(
      { error: 'invalid_state', message: `Assignment is ${assignment.status}, no longer pending` },
      { status: 409 },
    );
  }

  // Apply update
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
    .eq('status', 'pending'); // optimistic concurrency: only update if still pending

  if (updateErr) {
    console.error('[assignments PATCH] update error:', updateErr);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  console.info(
    `[assignments PATCH] id=${id} agent=${session.user.id} action=${action}` +
      (rejection_reason ? ` reason="${rejection_reason}"` : ''),
  );

  // ── Fan out to assigner: in-app notification + push ─────────────────────
  // Pull agent display name for the message
  const { data: agentRow } = await supabase
    .from('users')
    .select('name, username')
    .eq('id', session.user.id)
    .single();

  const agentName = agentRow?.name ?? session.user.name ?? '—';
  const agentUsername = agentRow?.username ?? '—';
  const storeName = (assignment.store as unknown as { name?: string } | null)?.name ?? '—';

  const notifType = action === 'accept' ? 'assignment_accepted' : 'assignment_rejected';

  // admin_notifications goes into the assigner's bell. user_id here keeps the
  // existing semantic of "the user this notification is ABOUT" — the bell
  // queries this table for admin/CEO consumption (no recipient_user_id field).
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

  // Push to the assigner (best-effort)
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
        { title, body: pushBody, url: '/assignments/new' },
        notifType,
      );
      console.info(
        `[assignments PATCH] push to assigner=${assignment.assigned_by} ` +
          `sent=${pushResult.sent}` + (pushResult.error ? ` error=${pushResult.error}` : ''),
      );
    } catch (err) {
      console.error('[assignments PATCH] push error (non-fatal):', err);
    }
  }

  return NextResponse.json({ ok: true, status: newStatus }, { headers: noCache });
}
