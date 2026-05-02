import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';
import { canManageAssignments } from '@/lib/permissions';
import {
  PUNCTUALITY_GRACE_MIN,
} from '@/lib/assignmentGeofence';

const noCache = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

const SUMMARY_ROW_CAP = 5000;

interface SummaryRow {
  agent_id: string;
  scheduled_start_time: string;
  shift_date: string;
  expected_duration_min: number;
  actual_entry_at: string | null;
  effective_minutes: number;
  met_duration: boolean | null;
  punctuality: 'on_time' | 'late' | 'no_show' | null;
  status: string;
  agent: { id: string; name: string } | null;
}

/**
 * GET /api/assignments/history/summary
 *
 * Same filter contract as /api/assignments/history. Pulls up to
 * SUMMARY_ROW_CAP filtered rows and aggregates them in JS:
 *   - total
 *   - met_rate, partial_rate, unmet_rate (% of rows in each bucket)
 *   - punctuality_rate (% on_time among rows with a verdict)
 *   - avg_effective_minutes (over rows with effective_minutes > 0)
 *   - avg_late_minutes (mean tardiness for late rows, in minutes)
 *   - top_agents     : top 5 agents by met-rate (min 2 rows each)
 *   - bottom_agents  : bottom 5 agents by met-rate (min 2 rows each)
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManageAssignments(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const from = sp.get('from') ?? undefined;
  const to = sp.get('to') ?? undefined;
  const csv = (key: string): string[] | undefined => {
    const v = sp.get(key);
    if (!v) return undefined;
    return v.split(',').map((s) => s.trim()).filter(Boolean);
  };
  const agents = csv('agents');
  const stores = csv('stores');
  const punctuality = csv('punctuality');
  const statuses = csv('statuses');
  const duration = csv('duration');

  let q = supabase
    .from('assignments')
    .select(`
      agent_id, shift_date, scheduled_start_time, expected_duration_min,
      actual_entry_at, effective_minutes, met_duration, punctuality, status,
      agent:users!assignments_agent_id_fkey ( id, name )
    `);

  if (from) q = q.gte('shift_date', from);
  if (to)   q = q.lte('shift_date', to);
  if (agents && agents.length) q = q.in('agent_id', agents);
  if (stores && stores.length) q = q.in('store_id', stores);
  if (statuses && statuses.length) q = q.in('status', statuses);
  if (punctuality && punctuality.length) q = q.in('punctuality', punctuality);

  if (duration && duration.length && duration.length < 3) {
    const buckets = new Set(duration);
    const ors: string[] = [];
    if (buckets.has('met')) ors.push('met_duration.eq.true');
    if (buckets.has('partial')) ors.push('and(met_duration.eq.false,effective_minutes.gt.0)');
    if (buckets.has('unmet')) ors.push('and(met_duration.eq.false,effective_minutes.eq.0)');
    if (ors.length) q = q.or(ors.join(','));
  }

  q = q.range(0, SUMMARY_ROW_CAP - 1);

  const { data, error } = await q;
  if (error) {
    console.error('[history/summary] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as SummaryRow[];
  const total = rows.length;

  let met = 0, partial = 0, unmet = 0;
  let onTime = 0, late = 0, noShow = 0, withVerdict = 0;
  let effectiveSum = 0, effectiveCount = 0;
  let lateMinutesSum = 0, lateMinutesCount = 0;

  type AgentStat = { agent_id: string; name: string; met: number; total: number };
  const byAgent = new Map<string, AgentStat>();

  for (const r of rows) {
    // Duration buckets
    if (r.met_duration === true) met++;
    else if (r.met_duration === false && r.effective_minutes > 0) partial++;
    else if (r.met_duration === false && r.effective_minutes === 0) unmet++;

    // Punctuality
    if (r.punctuality !== null) {
      withVerdict++;
      if (r.punctuality === 'on_time') onTime++;
      else if (r.punctuality === 'late') late++;
      else if (r.punctuality === 'no_show') noShow++;
    }

    // Avg effective time (only over rows that did some work)
    if (r.effective_minutes > 0) {
      effectiveSum += r.effective_minutes;
      effectiveCount++;
    }

    // Avg late minutes among late entries
    if (r.punctuality === 'late' && r.actual_entry_at) {
      const time = r.scheduled_start_time.length === 5
        ? `${r.scheduled_start_time}:00`
        : r.scheduled_start_time;
      const scheduled = new Date(`${r.shift_date}T${time}Z`);
      const entry = new Date(r.actual_entry_at);
      const diffMin = (entry.getTime() - scheduled.getTime()) / 60000 - PUNCTUALITY_GRACE_MIN;
      if (Number.isFinite(diffMin) && diffMin > 0) {
        lateMinutesSum += diffMin;
        lateMinutesCount++;
      }
    }

    // Per-agent tally for top/bottom
    const aid = r.agent_id;
    const aname = r.agent?.name ?? '—';
    let stat = byAgent.get(aid);
    if (!stat) {
      stat = { agent_id: aid, name: aname, met: 0, total: 0 };
      byAgent.set(aid, stat);
    }
    stat.total++;
    if (r.met_duration === true) stat.met++;
  }

  const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 100));

  const agentStats = Array.from(byAgent.values())
    .filter((a) => a.total >= 2)
    .map((a) => ({
      agent_id: a.agent_id,
      name: a.name,
      total: a.total,
      met: a.met,
      met_rate: pct(a.met, a.total),
    }));

  const top_agents = [...agentStats]
    .sort((a, b) => b.met_rate - a.met_rate || b.total - a.total)
    .slice(0, 5);
  const bottom_agents = [...agentStats]
    .sort((a, b) => a.met_rate - b.met_rate || a.total - b.total)
    .slice(0, 5);

  return NextResponse.json(
    {
      total,
      capped: total >= SUMMARY_ROW_CAP,
      duration_buckets: { met, partial, unmet },
      met_rate: pct(met, total),
      partial_rate: pct(partial, total),
      unmet_rate: pct(unmet, total),
      punctuality: { on_time: onTime, late, no_show: noShow, with_verdict: withVerdict },
      punctuality_rate: pct(onTime, withVerdict),
      avg_effective_minutes: effectiveCount === 0 ? 0 : Math.round(effectiveSum / effectiveCount),
      avg_late_minutes: lateMinutesCount === 0 ? 0 : Math.round(lateMinutesSum / lateMinutesCount),
      top_agents,
      bottom_agents,
    },
    { headers: noCache },
  );
}
