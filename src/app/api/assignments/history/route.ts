import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';
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

const VALID_SORTS = new Set(['shift_date', 'effective_minutes', 'created_at']);
const VALID_DIRS  = new Set(['asc', 'desc']);

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;
const CSV_ROW_CAP = 10000;

// Cumplimiento buckets
//   met     : met_duration = true
//   partial : met_duration = false AND effective_minutes > 0
//   unmet   : met_duration = false AND effective_minutes = 0
function applyDurationFilter(
  q: ReturnType<typeof baseSelect>,
  buckets: Set<string>,
) {
  if (buckets.size === 0 || buckets.size === 3) return q; // no-op
  const ors: string[] = [];
  if (buckets.has('met')) ors.push('met_duration.eq.true');
  if (buckets.has('partial')) ors.push('and(met_duration.eq.false,effective_minutes.gt.0)');
  if (buckets.has('unmet')) ors.push('and(met_duration.eq.false,effective_minutes.eq.0)');
  return q.or(ors.join(','));
}

function baseSelect() {
  return supabase
    .from('assignments')
    .select(`
      id, agent_id, assigned_by, cancelled_by, store_id, shift_date,
      scheduled_start_time, expected_duration_min, status,
      actual_entry_at, actual_exit_at, effective_minutes,
      met_duration, punctuality, rejection_reason,
      agent_response_at, cancelled_at, created_at, updated_at,
      cancelled_by_user:users!assignments_cancelled_by_fkey ( id, name, role ),
      agent:users!assignments_agent_id_fkey ( id, name, username ),
      store:stores ( id, name, address )
    `, { count: 'exact' });
}

interface FilterArgs {
  from?: string;       // YYYY-MM-DD
  to?: string;         // YYYY-MM-DD
  agents?: Set<string>;
  stores?: Set<string>;
  duration?: Set<string>;     // 'met' | 'partial' | 'unmet'
  punctuality?: Set<string>;  // 'on_time' | 'late' | 'no_show'
  statuses?: Set<string>;
}

function parseFilters(sp: URLSearchParams): FilterArgs {
  const csv = (key: string) => {
    const v = sp.get(key);
    if (!v) return undefined;
    return new Set(v.split(',').map((s) => s.trim()).filter(Boolean));
  };
  return {
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    agents: csv('agents'),
    stores: csv('stores'),
    duration: csv('duration'),
    punctuality: csv('punctuality'),
    statuses: csv('statuses'),
  };
}

type QueryBuilder = ReturnType<typeof baseSelect>;

function applyFilters(q: QueryBuilder, f: FilterArgs): QueryBuilder {
  if (f.from) q = q.gte('shift_date', f.from);
  if (f.to)   q = q.lte('shift_date', f.to);
  if (f.agents && f.agents.size > 0) q = q.in('agent_id', Array.from(f.agents));
  if (f.stores && f.stores.size > 0) q = q.in('store_id', Array.from(f.stores));
  if (f.statuses && f.statuses.size > 0) {
    q = q.in('status', Array.from(f.statuses));
  } else {
    // Default view excludes 'replaced' rows — they're historical noise
    // (the row was superseded by another for the same agent+day) and the
    // CEO never asked for them. They remain queryable via explicit
    // statuses=replaced for audit purposes.
    q = q.neq('status', 'replaced');
  }
  if (f.punctuality && f.punctuality.size > 0) q = q.in('punctuality', Array.from(f.punctuality));
  if (f.duration && f.duration.size > 0) q = applyDurationFilter(q, f.duration);
  return q;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/assignments/history
//
// Query:
//   from, to                    — date range (YYYY-MM-DD)
//   agents=id1,id2              — filter by agent ids
//   stores=id1,id2
//   duration=met,partial,unmet  — derived buckets
//   punctuality=on_time,late,no_show
//   statuses=completed,incomplete,rejected,cancelled,pending,accepted,in_progress
//   sort=shift_date|effective_minutes|created_at  (default shift_date)
//   dir=asc|desc                (default desc)
//   page=1, pageSize=50         (max 200)
//   format=csv                  — return text/csv ignoring page/pageSize
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManageAssignments(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const filters = parseFilters(sp);

  const sort = VALID_SORTS.has(sp.get('sort') ?? '') ? sp.get('sort')! : 'shift_date';
  const dir  = VALID_DIRS.has(sp.get('dir') ?? '')   ? sp.get('dir')!  : 'desc';
  const ascending = dir === 'asc';

  const format = sp.get('format');

  if (format === 'csv') {
    return await csvResponse(filters, sort, ascending);
  }

  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(sp.get('pageSize') ?? String(PAGE_SIZE_DEFAULT), 10) || PAGE_SIZE_DEFAULT));
  const fromIdx = (page - 1) * pageSize;
  const toIdx = fromIdx + pageSize - 1;

  let q: QueryBuilder = applyFilters(baseSelect(), filters);
  q = q.order(sort, { ascending }).order('scheduled_start_time', { ascending }).range(fromIdx, toIdx);

  const { data, error, count } = await q;
  if (error) {
    console.error('[history GET] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Enrich in_progress rows with effective_ms_now so the client can render
  // a live-updating value without needing to call /today on top of /history.
  const enriched = await enrichInProgressRows(data ?? []);

  return NextResponse.json(
    { assignments: enriched, total: count ?? 0, page, pageSize, serverNow: new Date().toISOString() },
    { headers: noCache },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV export
// ─────────────────────────────────────────────────────────────────────────────
async function csvResponse(filters: FilterArgs, sort: string, ascending: boolean) {
  let q: QueryBuilder = applyFilters(baseSelect(), filters);
  q = q.order(sort, { ascending }).order('scheduled_start_time', { ascending }).range(0, CSV_ROW_CAP - 1);

  const { data, error } = await q;
  if (error) {
    console.error('[history CSV] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as HistoryRow[];
  const csv = buildCsv(rows);

  // Filename includes the active range for context
  const fromLabel = filters.from ?? 'all';
  const toLabel = filters.to ?? 'all';
  const filename = `assignments_${fromLabel}_to_${toLabel}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

interface HistoryRow {
  id: string;
  shift_date: string;
  scheduled_start_time: string;
  expected_duration_min: number;
  actual_entry_at: string | null;
  actual_exit_at: string | null;
  effective_minutes: number;
  met_duration: boolean | null;
  punctuality: string | null;
  status: string;
  rejection_reason: string | null;
  agent: { id: string; name: string; username: string } | null;
  store: { id: string; name: string; address: string | null } | null;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(rows: HistoryRow[]): string {
  const headers = [
    'shift_date',
    'agent_name',
    'agent_username',
    'store_name',
    'store_address',
    'scheduled_start_time',
    'actual_entry_at',
    'actual_exit_at',
    'expected_duration_min',
    'effective_minutes',
    'met_duration',
    'punctuality',
    'status',
    'rejection_reason',
  ];
  const lines: string[] = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      r.shift_date,
      r.agent?.name ?? '',
      r.agent?.username ?? '',
      r.store?.name ?? '',
      r.store?.address ?? '',
      r.scheduled_start_time,
      r.actual_entry_at ?? '',
      r.actual_exit_at ?? '',
      r.expected_duration_min,
      r.effective_minutes,
      r.met_duration === null ? '' : r.met_duration ? 'true' : 'false',
      r.punctuality ?? '',
      r.status,
      r.rejection_reason ?? '',
    ].map(csvEscape).join(','));
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Enrich in_progress rows with `effective_ms_now` so the client can show a
// live-updating value for currently-running shifts. Persisted rows
// (completed/incomplete/etc.) keep their static `effective_minutes`. We only
// fetch events for the in_progress subset to keep the query focused.
// ─────────────────────────────────────────────────────────────────────────────
type RowWithMaybeLive = Record<string, unknown> & {
  id: string;
  status: string;
  actual_exit_at: string | null;
};

async function enrichInProgressRows(rows: RowWithMaybeLive[]): Promise<RowWithMaybeLive[]> {
  const inProgressIds = rows.filter((r) => r.status === 'in_progress').map((r) => r.id);
  if (inProgressIds.length === 0) return rows;

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
  return rows.map((r) => {
    if (r.status !== 'in_progress') return r;
    const evs = byAssignment.get(r.id) ?? [];
    return { ...r, effective_ms_now: computeEffectiveMs(evs, now) };
  });
}
