import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { COMPANY_BONUS_TYPES, type CompanyBonusType } from '@/lib/payroll/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/payroll/company-bonuses
 *
 * Query params:
 *   pay_week, bonus_type (csv), distributed ('1' | '0'), search
 *   export ('csv') → returns text/csv instead of JSON
 *
 * Returns rows + distributed totals + counts. Admin/CEO only.
 */
export async function GET(req: NextRequest) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const payWeek = url.searchParams.get('pay_week');
  const typeParam = url.searchParams.get('bonus_type');
  const distributed = url.searchParams.get('distributed');
  const search = url.searchParams.get('search')?.trim().toLowerCase() ?? '';
  const exportMode = url.searchParams.get('export');

  let q = supabase
    .from('company_bonuses')
    .select('*')
    .order('pay_week', { ascending: false })
    .order('created_at', { ascending: false });

  if (payWeek) q = q.eq('pay_week', payWeek);
  if (typeParam) {
    const list = typeParam.split(',').map((s) => s.trim()).filter(Boolean)
      .filter((s) => (COMPANY_BONUS_TYPES as readonly string[]).includes(s)) as CompanyBonusType[];
    if (list.length > 0) q = q.in('bonus_type', list);
  }
  if (distributed === '1') q = q.eq('paid_to_agents', true);
  else if (distributed === '0') q = q.eq('paid_to_agents', false);

  const { data: bonuses, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Filter by search client-side (description / source_sale).
  const filtered = (bonuses ?? []).filter((b) => {
    if (!search) return true;
    return b.description?.toLowerCase().includes(search);
  });

  // Hydrate per-bonus distributed totals.
  const bonusIds = filtered.map((b) => b.id);
  const { data: dists } = bonusIds.length
    ? await supabase
        .from('bonus_distributions')
        .select('company_bonus_id, amount, recipient_id')
        .in('company_bonus_id', bonusIds)
    : { data: [] };
  const distByBonus = new Map<string, { distributed_total: number; recipient_count: number }>();
  for (const d of (dists ?? [])) {
    const acc = distByBonus.get(d.company_bonus_id) ?? { distributed_total: 0, recipient_count: 0 };
    acc.distributed_total += Number(d.amount);
    acc.recipient_count += 1;
    distByBonus.set(d.company_bonus_id, acc);
  }

  const rows = filtered.map((b) => {
    const dist = distByBonus.get(b.id) ?? { distributed_total: 0, recipient_count: 0 };
    return {
      ...b,
      distributed_total: dist.distributed_total,
      recipient_count: dist.recipient_count,
      remaining_for_company: Number(b.total_amount) - dist.distributed_total,
    };
  });

  if (exportMode === 'csv') {
    const header = [
      'id', 'bonus_type', 'description', 'pay_week', 'total_amount',
      'paid_to_agents', 'distributed_total', 'remaining_for_company',
      'recipient_count', 'notes',
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([
        r.id,
        r.bonus_type,
        csvField(r.description),
        r.pay_week,
        Number(r.total_amount).toFixed(2),
        r.paid_to_agents ? 'true' : 'false',
        r.distributed_total.toFixed(2),
        r.remaining_for_company.toFixed(2),
        r.recipient_count,
        csvField(r.notes ?? ''),
      ].join(','));
    }
    return new NextResponse(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="company-bonuses-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  const pendingCount = filtered.filter((b) => !b.paid_to_agents).length;

  return NextResponse.json({
    rows,
    summary: {
      total: filtered.length,
      pending: pendingCount,
    },
  });
}

function csvField(v: string): string {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
