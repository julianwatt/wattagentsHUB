import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { getSalesForPayWeek, validateSalesForPayWeek } from '@/lib/payroll/rates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/payroll/sales?pay_week=YYYY-MM-DD
 *
 * Returns the list of sales tied to that pay_week (PAYABLE / WINBACK /
 * CHARGEBACK) plus the validation summary that drives the Pendientes
 * sub-view's semáforo.
 *
 * GET /api/payroll/sales?pay_week=YYYY-MM-DD&summary=1
 *   Returns only the validation summary (lightweight call for the badge
 *   indicator).
 *
 * GET /api/payroll/sales?weeks=1
 *   Returns the distinct pay_weeks currently in payroll_sales, newest first.
 */
export async function GET(req: NextRequest) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);

  // Distinct pay_weeks for the selector.
  if (url.searchParams.get('weeks') === '1') {
    const { data, error } = await supabase
      .from('payroll_sales')
      .select('pay_week')
      .not('pay_week', 'is', null)
      .order('pay_week', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const weeks = Array.from(new Set((data ?? []).map((r) => r.pay_week as string)));
    return NextResponse.json(weeks);
  }

  const payWeek = url.searchParams.get('pay_week') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payWeek)) {
    return NextResponse.json({ error: 'pay_week inválido (use YYYY-MM-DD).' }, { status: 400 });
  }

  if (url.searchParams.get('summary') === '1') {
    const validation = await validateSalesForPayWeek(payWeek);
    return NextResponse.json({ validation });
  }

  const [sales, validation] = await Promise.all([
    getSalesForPayWeek(payWeek),
    validateSalesForPayWeek(payWeek),
  ]);

  // Hydrate agent name + plan_mapping summary for the table view. One query
  // each, joined client-side; saves the JS layer from doing relational lookups
  // and keeps each fetch under the supabase-js 1000-row default.
  const agentIds = Array.from(
    new Set(sales.map((s) => s.internal_agent_id).filter((id): id is string => !!id)),
  );
  const mappingIds = Array.from(
    new Set(sales.map((s) => s.plan_mapping_id).filter((id): id is string => !!id)),
  );

  const [{ data: agents }, { data: mappings }] = await Promise.all([
    agentIds.length > 0
      ? supabase.from('users').select('id, name').in('id', agentIds)
      : Promise.resolve({ data: [] }),
    mappingIds.length > 0
      ? supabase
          .from('plan_mappings')
          .select('id, plan_name, plan_type, campaign')
          .in('id', mappingIds)
      : Promise.resolve({ data: [] }),
  ]);
  const agentById = new Map((agents ?? []).map((a) => [a.id, a.name]));
  const mappingById = new Map((mappings ?? []).map((m) => [m.id, m]));

  return NextResponse.json({
    pay_week: payWeek,
    validation,
    sales: sales.map((s) => ({
      ...s,
      agent_name: s.internal_agent_id ? agentById.get(s.internal_agent_id) ?? null : null,
      plan_mapping: s.plan_mapping_id ? mappingById.get(s.plan_mapping_id) ?? null : null,
    })),
  });
}
