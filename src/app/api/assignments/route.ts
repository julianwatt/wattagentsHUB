import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';
import { canManageAssignments } from '@/lib/permissions';
import { sendPushToUser } from '@/lib/push';

const noCache = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

// Allowed start-time slots: 10:00, 10:30, ..., 13:00
const ALLOWED_SLOTS = ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00'];

// ──────────────────────────────────────────────────────────────────────────────
// GET — list assignments. Query params:
//   ?date=YYYY-MM-DD            → assignments for a specific date
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD → range
//   ?agent_id=...               → filter by agent
//   ?statuses=pending,accepted  → filter by status (csv)
//   ?assigned_by_me=1           → only those created by the current user
//   ?limit=N                    → max rows (default 100, max 500)
// ──────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManageAssignments(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const date = sp.get('date');
  const from = sp.get('from');
  const to = sp.get('to');
  const agentId = sp.get('agent_id');
  const statusesCsv = sp.get('statuses');
  const assignedByMe = sp.get('assigned_by_me') === '1';
  const limit = Math.min(500, Math.max(1, parseInt(sp.get('limit') ?? '100', 10) || 100));

  let q = supabase
    .from('assignments')
    .select(`
      id, agent_id, assigned_by, store_id, shift_date,
      scheduled_start_time, expected_duration_min, status,
      actual_entry_at, actual_exit_at, effective_minutes,
      met_duration, punctuality, agent_response_at, rejection_reason,
      cancelled_at, cancelled_by, created_at, updated_at,
      agent:users!assignments_agent_id_fkey ( id, name, username ),
      assigner:users!assignments_assigned_by_fkey ( id, name, username ),
      store:stores ( id, name, address )
    `)
    .order('shift_date', { ascending: false })
    .order('scheduled_start_time', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (date) q = q.eq('shift_date', date);
  if (from) q = q.gte('shift_date', from);
  if (to) q = q.lte('shift_date', to);
  if (agentId) q = q.eq('agent_id', agentId);
  if (assignedByMe) q = q.eq('assigned_by', session.user.id);
  if (statusesCsv) {
    const arr = statusesCsv.split(',').map((s) => s.trim()).filter(Boolean);
    if (arr.length) q = q.in('status', arr);
  }

  const { data, error } = await q;
  if (error) {
    console.error('[assignments GET] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ assignments: data ?? [] }, { headers: noCache });
}

// ──────────────────────────────────────────────────────────────────────────────
// POST — create assignment. Body:
//   { agent_id, store_id, shift_date (YYYY-MM-DD),
//     scheduled_start_time (HH:MM), expected_duration_min? }
//
// Validates everything server-side. Inserts the assignment, fans out a
// user_notifications row to the agent, and (best-effort) a push notification.
// ──────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManageAssignments(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const agent_id: string | undefined = body?.agent_id;
  const store_id: string | undefined = body?.store_id;
  const shift_date: string | undefined = body?.shift_date;
  const scheduled_start_time: string | undefined = body?.scheduled_start_time;
  const expected_duration_min: number =
    Number.isFinite(body?.expected_duration_min) ? Math.floor(body.expected_duration_min) : 360;

  // Required-field validation
  if (!agent_id || !store_id || !shift_date || !scheduled_start_time) {
    return NextResponse.json(
      { error: 'agent_id, store_id, shift_date and scheduled_start_time are required' },
      { status: 400 },
    );
  }

  // Slot validation
  if (!ALLOWED_SLOTS.includes(scheduled_start_time)) {
    return NextResponse.json(
      { error: `scheduled_start_time must be one of: ${ALLOWED_SLOTS.join(', ')}` },
      { status: 400 },
    );
  }

  // Date validation: not in the past (compared to today, agent's local time
  // is unknown so we compare in server local-day terms)
  const todayStr = new Date().toISOString().slice(0, 10);
  if (shift_date < todayStr) {
    return NextResponse.json({ error: 'shift_date cannot be in the past' }, { status: 400 });
  }

  // Duration validation: 240–480 minutes (4h–8h) in 30-min steps
  if (
    expected_duration_min < 240 ||
    expected_duration_min > 480 ||
    expected_duration_min % 30 !== 0
  ) {
    return NextResponse.json(
      { error: 'expected_duration_min must be between 240 and 480, in 30-min increments' },
      { status: 400 },
    );
  }

  // Verify the target user exists, is active, and is an agent
  const { data: agent } = await supabase
    .from('users')
    .select('id, role, name, username, is_active')
    .eq('id', agent_id)
    .single();
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }
  if (!agent.is_active) {
    return NextResponse.json({ error: 'Agent is not active' }, { status: 400 });
  }
  // Agents and managers (jr/sr) can be assigned. Higher roles cannot.
  if (!['agent', 'jr_manager', 'sr_manager'].includes(agent.role)) {
    return NextResponse.json({ error: 'Target user role cannot receive assignments' }, { status: 400 });
  }

  // Verify store exists
  const { data: store } = await supabase
    .from('stores')
    .select('id, name, address')
    .eq('id', store_id)
    .single();
  if (!store) {
    return NextResponse.json({ error: 'Store not found' }, { status: 404 });
  }

  // Pre-flight duplicate check (gives a nicer error than the partial unique
  // index conflict). Race conditions are still caught by the index below.
  const { data: existing } = await supabase
    .from('assignments')
    .select('id, status')
    .eq('agent_id', agent_id)
    .eq('shift_date', shift_date)
    .in('status', ['pending', 'accepted', 'in_progress', 'completed', 'incomplete'])
    .limit(1);
  if (existing && existing.length > 0) {
    return NextResponse.json(
      { error: 'duplicate', message: 'El agente ya tiene una asignación activa para esa fecha' },
      { status: 409 },
    );
  }

  // Insert
  const { data: created, error: insertErr } = await supabase
    .from('assignments')
    .insert({
      agent_id,
      assigned_by: session.user.id,
      store_id,
      shift_date,
      scheduled_start_time,
      expected_duration_min,
      status: 'pending',
    })
    .select(`
      id, agent_id, assigned_by, store_id, shift_date,
      scheduled_start_time, expected_duration_min, status, created_at,
      agent:users!assignments_agent_id_fkey ( id, name, username ),
      store:stores ( id, name, address )
    `)
    .single();

  if (insertErr) {
    // Partial-unique-index conflict raised by Postgres
    if (insertErr.code === '23505') {
      return NextResponse.json(
        { error: 'duplicate', message: 'El agente ya tiene una asignación activa para esa fecha' },
        { status: 409 },
      );
    }
    console.error('[assignments POST] insert error:', insertErr);
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  console.info(
    `[assignments POST] created id=${created.id} agent=${agent_id} store=${store_id} ` +
      `date=${shift_date} time=${scheduled_start_time} by=${session.user.id}`,
  );

  // ── Fan out: in-app notification + push ─────────────────────────────────────
  // Format: "Watt Distributors Office – Irving · 2026-05-02 · 10:30"
  const niceDate = shift_date;
  const title = '📋 Nueva asignación pendiente';
  const body_es =
    `Tienes una asignación pendiente: ${store.name} · ${niceDate} · ${scheduled_start_time}.`;

  // In-app notification (agent inbox)
  const { error: notifErr } = await supabase.from('user_notifications').insert({
    recipient_user_id: agent_id,
    type: 'assignment_pending',
    title,
    body: body_es,
    data: {
      assignment_id: created.id,
      store_id,
      store_name: store.name,
      shift_date,
      scheduled_start_time,
      expected_duration_min,
    },
    status: 'pending',
  });
  if (notifErr) {
    console.error('[assignments POST] user_notifications insert error:', notifErr);
  }

  // Push (best-effort, never blocks)
  try {
    const pushResult = await sendPushToUser(
      agent_id,
      { title, body: body_es, url: '/home' },
      'assignment_pending',
    );
    console.info(
      `[assignments POST] push to agent=${agent_id} sent=${pushResult.sent}` +
        (pushResult.error ? ` error=${pushResult.error}` : ''),
    );
  } catch (err) {
    console.error('[assignments POST] push error (non-fatal):', err);
  }

  return NextResponse.json({ assignment: created }, { status: 201, headers: noCache });
}
