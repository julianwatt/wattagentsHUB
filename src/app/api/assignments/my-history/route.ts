import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';
import {
  computeEffectiveMs,
  type AssignmentEvent,
  type GeofenceEventType,
} from '@/lib/assignmentGeofence';

const noCache = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

const VALID_SORTS = new Set(['shift_date', 'effective_minutes', 'created_at']);
const VALID_DIRS  = new Set(['asc', 'desc']);
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

/**
 * GET /api/assignments/my-history
 *
 * The agent's own history. The query is ALWAYS scoped to the authenticated
 * user's id — the client cannot widen the scope. Mirrors the filter contract
 * of /api/assignments/history but without agent/store-multi filters and the
 * CSV format (agent-side stays simple).
 *
 * Filters: from, to, duration (met/partial/unmet), punctuality, statuses.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;
  const sp = new URL(req.url).searchParams;

  const csv = (key: string): Set<string> | null => {
    const v = sp.get(key);
    if (!v) return null;
    return new Set(v.split(',').map((s) => s.trim()).filter(Boolean));
  };

  const from = sp.get('from') ?? undefined;
  const to = sp.get('to') ?? undefined;
  const duration = csv('duration');
  const punctuality = csv('punctuality');
  const statuses = csv('statuses');

  const sort = VALID_SORTS.has(sp.get('sort') ?? '') ? sp.get('sort')! : 'shift_date';
  const dir  = VALID_DIRS.has(sp.get('dir') ?? '')   ? sp.get('dir')!  : 'desc';
  const ascending = dir === 'asc';

  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(sp.get('pageSize') ?? String(PAGE_SIZE_DEFAULT), 10) || PAGE_SIZE_DEFAULT));
  const fromIdx = (page - 1) * pageSize;
  const toIdx = fromIdx + pageSize - 1;

  let q = supabase
    .from('assignments')
    .select(`
      id, agent_id, store_id, shift_date,
      scheduled_start_time, expected_duration_min, status,
      actual_entry_at, actual_exit_at, effective_minutes,
      met_duration, punctuality, rejection_reason,
      agent_response_at, created_at, cancelled_at, cancelled_by,
      cancelled_by_user:users!assignments_cancelled_by_fkey ( id, name, role ),
      store:stores ( id, name, address )
    `, { count: 'exact' })
    .eq('agent_id', userId);

  if (from) q = q.gte('shift_date', from);
  if (to)   q = q.lte('shift_date', to);
  if (statuses && statuses.size > 0) {
    q = q.in('status', Array.from(statuses));
  } else {
    // Same default as /api/assignments/history: hide 'replaced' rows
    // unless the agent explicitly filters for them.
    q = q.neq('status', 'replaced');
  }
  if (punctuality && punctuality.size > 0) q = q.in('punctuality', Array.from(punctuality));
  if (duration && duration.size > 0 && duration.size < 3) {
    const ors: string[] = [];
    if (duration.has('met')) ors.push('met_duration.eq.true');
    if (duration.has('partial')) ors.push('and(met_duration.eq.false,effective_minutes.gt.0)');
    if (duration.has('unmet')) ors.push('and(met_duration.eq.false,effective_minutes.eq.0)');
    if (ors.length) q = q.or(ors.join(','));
  }

  q = q.order(sort, { ascending }).order('scheduled_start_time', { ascending }).range(fromIdx, toIdx);

  const { data, error, count } = await q;
  if (error) {
    console.error('[my-history GET] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Enrich in_progress rows with effective_ms_now (matches /api/assignments/history)
  const rows = (data ?? []) as Array<Record<string, unknown> & { id: string; status: string }>;
  const inProgressIds = rows.filter((r) => r.status === 'in_progress').map((r) => r.id);
  if (inProgressIds.length > 0) {
    const { data: eData } = await supabase
      .from('assignment_geofence_events')
      .select('assignment_id, event_type, occurred_at')
      .in('assignment_id', inProgressIds)
      .order('occurred_at', { ascending: true });
    const events = (eData ?? []) as { assignment_id: string; event_type: GeofenceEventType; occurred_at: string }[];
    const byAssignment = new Map<string, AssignmentEvent[]>();
    for (const ev of events) {
      if (!byAssignment.has(ev.assignment_id)) byAssignment.set(ev.assignment_id, []);
      byAssignment.get(ev.assignment_id)!.push({ event_type: ev.event_type, occurred_at: ev.occurred_at });
    }
    const now = new Date();
    for (const r of rows) {
      if (r.status === 'in_progress') {
        r.effective_ms_now = computeEffectiveMs(byAssignment.get(r.id) ?? [], now);
      }
    }
  }

  return NextResponse.json(
    { assignments: rows, total: count ?? 0, page, pageSize, serverNow: new Date().toISOString() },
    { headers: noCache },
  );
}
