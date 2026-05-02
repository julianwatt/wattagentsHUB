import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';

const noCache = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

const SUMMARY_ROW_CAP = 5000;

interface SummaryRow {
  effective_minutes: number;
  met_duration: boolean | null;
  punctuality: 'on_time' | 'late' | 'no_show' | null;
}

/**
 * GET /api/assignments/my-history/summary
 *
 * Agent's personal aggregates over their own assignments (always scoped to
 * session.user.id). Same filter contract as my-history.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;
  const sp = new URL(req.url).searchParams;
  const from = sp.get('from') ?? undefined;
  const to = sp.get('to') ?? undefined;

  const csv = (key: string): Set<string> | null => {
    const v = sp.get(key);
    if (!v) return null;
    return new Set(v.split(',').map((s) => s.trim()).filter(Boolean));
  };
  const duration = csv('duration');
  const punctuality = csv('punctuality');
  const statuses = csv('statuses');

  let q = supabase
    .from('assignments')
    .select('effective_minutes, met_duration, punctuality')
    .eq('agent_id', userId);

  if (from) q = q.gte('shift_date', from);
  if (to)   q = q.lte('shift_date', to);
  if (statuses && statuses.size > 0) q = q.in('status', Array.from(statuses));
  if (punctuality && punctuality.size > 0) q = q.in('punctuality', Array.from(punctuality));
  if (duration && duration.size > 0 && duration.size < 3) {
    const ors: string[] = [];
    if (duration.has('met')) ors.push('met_duration.eq.true');
    if (duration.has('partial')) ors.push('and(met_duration.eq.false,effective_minutes.gt.0)');
    if (duration.has('unmet')) ors.push('and(met_duration.eq.false,effective_minutes.eq.0)');
    if (ors.length) q = q.or(ors.join(','));
  }

  q = q.range(0, SUMMARY_ROW_CAP - 1);

  const { data, error } = await q;
  if (error) {
    console.error('[my-history/summary] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as SummaryRow[];
  const total = rows.length;

  let met = 0;
  let onTime = 0, withVerdict = 0;
  let totalMinutes = 0, effectiveCount = 0;

  for (const r of rows) {
    if (r.met_duration === true) met++;
    if (r.punctuality !== null) {
      withVerdict++;
      if (r.punctuality === 'on_time') onTime++;
    }
    if (r.effective_minutes > 0) {
      totalMinutes += r.effective_minutes;
      effectiveCount++;
    }
  }

  const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 100));

  return NextResponse.json(
    {
      total,
      capped: total >= SUMMARY_ROW_CAP,
      met_rate: pct(met, total),
      punctuality_rate: pct(onTime, withVerdict),
      total_minutes: totalMinutes,
      avg_effective_minutes: effectiveCount === 0 ? 0 : Math.round(totalMinutes / effectiveCount),
    },
    { headers: noCache },
  );
}
