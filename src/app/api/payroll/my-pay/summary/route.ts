import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';
import type { PayfileLineType } from '@/lib/payroll/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/payroll/my-pay/summary
 *
 * Aggregates the caller's PUBLISHED payfiles into:
 *   - Month-to-date: total, payable count, chargeback count, avg per week
 *   - Year-to-date:  total, monthly buckets for the chart
 *
 * Reads payfiles.total_amount for totals and payfile_line_items.line_type
 * for the payable / chargeback counts. Both come from the calc that block
 * 06+ produced; this endpoint is read-only.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;
  const now = new Date();
  const year = now.getUTCFullYear();
  const monthStart = `${year}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const { data: payfiles } = await supabase
    .from('payfiles')
    .select('id, pay_week, total_amount, had_negative_balance')
    .eq('user_id', userId)
    .eq('state', 'PUBLISHED')
    .gte('pay_week', yearStart)
    .lte('pay_week', yearEnd)
    .order('pay_week', { ascending: true });

  type Row = { id: string; pay_week: string; total_amount: number; had_negative_balance: boolean };
  const rows = (payfiles ?? []) as Row[];

  const ids = rows.map((p) => p.id);
  const { data: lines } = ids.length
    ? await supabase
        .from('payfile_line_items')
        .select('payfile_id, line_type, amount')
        .in('payfile_id', ids)
    : { data: [] };

  const linesByPf = new Map<string, Array<{ line_type: PayfileLineType; amount: number }>>();
  for (const l of (lines ?? [])) {
    const arr = linesByPf.get((l as { payfile_id: string }).payfile_id) ?? [];
    arr.push(l as { payfile_id: string; line_type: PayfileLineType; amount: number });
    linesByPf.set((l as { payfile_id: string }).payfile_id, arr);
  }

  // Aggregates.
  let yearTotal = 0;
  let monthTotal = 0;
  let yearPayables = 0;
  let yearChargebacks = 0;
  let monthPayables = 0;
  let monthChargebacks = 0;
  let monthPayfileCount = 0;

  // 12-month bucket for the chart (Jan=0..Dec=11).
  const monthlyBuckets: number[] = Array(12).fill(0);

  for (const pf of rows) {
    yearTotal += Number(pf.total_amount);
    const month = Number(pf.pay_week.slice(5, 7)) - 1;
    monthlyBuckets[month] += Number(pf.total_amount);
    const inMonth = pf.pay_week >= monthStart;
    if (inMonth) {
      monthTotal += Number(pf.total_amount);
      monthPayfileCount += 1;
    }
    const myLines = linesByPf.get(pf.id) ?? [];
    for (const l of myLines) {
      // A "payable" line is a positive commission or override; a "chargeback"
      // is the same types with negative amount.
      if (l.line_type === 'COMMISSION' || l.line_type === 'OVERRIDE') {
        if (l.amount >= 0) {
          yearPayables += 1;
          if (inMonth) monthPayables += 1;
        } else {
          yearChargebacks += 1;
          if (inMonth) monthChargebacks += 1;
        }
      }
    }
  }

  const monthAvgPerWeek = monthPayfileCount > 0 ? monthTotal / monthPayfileCount : 0;

  return NextResponse.json({
    month: {
      start: monthStart,
      total: monthTotal,
      payfile_count: monthPayfileCount,
      payables: monthPayables,
      chargebacks: monthChargebacks,
      avg_per_week: monthAvgPerWeek,
    },
    year: {
      start: yearStart,
      total: yearTotal,
      payables: yearPayables,
      chargebacks: yearChargebacks,
      monthly_buckets: monthlyBuckets,
    },
  });
}
