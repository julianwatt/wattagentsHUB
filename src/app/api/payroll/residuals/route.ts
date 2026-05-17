import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { RESIDUAL_TYPES, type ResidualType } from '@/lib/payroll/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/payroll/residuals
 *
 * Query params:
 *   residual_type, pay_week, from, to, agent_id, search,
 *   export ('csv') for CSV download.
 *
 * Returns rows + totals per type. Admin/CEO only.
 */
export async function GET(req: NextRequest) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const typeParam = url.searchParams.get('residual_type');
  const payWeek = url.searchParams.get('pay_week');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const agentId = url.searchParams.get('agent_id');
  const search = url.searchParams.get('search')?.trim().toLowerCase() ?? '';
  const exportMode = url.searchParams.get('export');

  let q = supabase
    .from('residuals')
    .select('id, source_sale_id, residual_type, amount, pay_week, original_je_data, notes, created_at')
    .order('pay_week', { ascending: false })
    .order('created_at', { ascending: false });

  if (typeParam) {
    const list = typeParam.split(',').map((s) => s.trim()).filter(Boolean)
      .filter((s) => (RESIDUAL_TYPES as readonly string[]).includes(s)) as ResidualType[];
    if (list.length > 0) q = q.in('residual_type', list);
  }
  if (payWeek) q = q.eq('pay_week', payWeek);
  if (from) q = q.gte('pay_week', from);
  if (to) q = q.lte('pay_week', to);

  const { data: residuals, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Hydrate the originating sale (contract / customer / agent).
  const saleIds = Array.from(new Set((residuals ?? []).map((r) => r.source_sale_id).filter(Boolean)));
  const { data: sales } = saleIds.length
    ? await supabase
        .from('payroll_sales')
        .select('id, contract_id, customer_name, plan_name, internal_agent_id')
        .in('id', saleIds)
    : { data: [] };
  const saleById = new Map((sales ?? []).map((s) => [s.id, s]));

  const agentIds = Array.from(new Set((sales ?? []).map((s) => s.internal_agent_id).filter(Boolean)));
  const { data: agents } = agentIds.length
    ? await supabase.from('users').select('id, name').in('id', agentIds)
    : { data: [] };
  const agentNameById = new Map((agents ?? []).map((u) => [u.id, u.name]));

  type Hydrated = {
    id: string; residual_type: ResidualType; amount: number; pay_week: string;
    notes: string | null; created_at: string;
    contract_id: string | null; customer_name: string | null; plan_name: string | null;
    agent_id: string | null; agent_name: string | null;
  };

  const hydrated: Hydrated[] = (residuals ?? []).map((r) => {
    const sale = r.source_sale_id ? saleById.get(r.source_sale_id) : null;
    return {
      id: r.id,
      residual_type: r.residual_type,
      amount: Number(r.amount),
      pay_week: r.pay_week,
      notes: r.notes,
      created_at: r.created_at,
      contract_id: sale ? (sale as { contract_id: string }).contract_id : null,
      customer_name: sale ? (sale as { customer_name: string | null }).customer_name : null,
      plan_name: sale ? (sale as { plan_name: string }).plan_name : null,
      agent_id: sale ? (sale as { internal_agent_id: string | null }).internal_agent_id : null,
      agent_name: sale && (sale as { internal_agent_id: string | null }).internal_agent_id
        ? agentNameById.get((sale as { internal_agent_id: string }).internal_agent_id) ?? null : null,
    };
  });

  // Client-side filter for free-text search and agent.
  const filtered = hydrated.filter((r) => {
    if (agentId && r.agent_id !== agentId) return false;
    if (!search) return true;
    return (
      (r.contract_id ?? '').toLowerCase().includes(search) ||
      (r.customer_name ?? '').toLowerCase().includes(search) ||
      (r.plan_name ?? '').toLowerCase().includes(search) ||
      (r.agent_name ?? '').toLowerCase().includes(search)
    );
  });

  if (exportMode === 'csv') {
    const header = ['residual_type', 'contract_id', 'customer_name', 'plan_name', 'agent', 'pay_week', 'amount', 'notes'];
    const lines = [header.join(',')];
    for (const r of filtered) {
      lines.push([
        r.residual_type,
        csvField(r.contract_id ?? ''),
        csvField(r.customer_name ?? ''),
        csvField(r.plan_name ?? ''),
        csvField(r.agent_name ?? ''),
        r.pay_week,
        r.amount.toFixed(2),
        csvField(r.notes ?? ''),
      ].join(','));
    }
    return new NextResponse(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="residuals-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  // Totals by type.
  const totalsByType: Record<string, { count: number; amount: number }> = {};
  for (const r of filtered) {
    const t = r.residual_type;
    totalsByType[t] ??= { count: 0, amount: 0 };
    totalsByType[t].count += 1;
    totalsByType[t].amount += r.amount;
  }
  const grandTotal = filtered.reduce((acc, r) => acc + r.amount, 0);

  return NextResponse.json({
    rows: filtered,
    totals_by_type: totalsByType,
    grand_total: grandTotal,
    row_count: filtered.length,
  });
}

function csvField(v: string): string {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
