import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { getSalesForPayWeek, validateSalesForPayWeek } from '@/lib/payroll/rates';
import { SALE_STATUSES, type SaleStatus } from '@/lib/payroll/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RASTREO_PAGE_SIZE = 50;
const RASTREO_EXPORT_CAP = 10_000;

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

  // Block 14 — full sales tracking view. Paginated, filterable, free-text
  // searchable. Returns hydrated rows with agent + plan_mapping + manager
  // names and a flat manager-by-level lookup the UI uses to render
  // "Manager 1 / 2 / 3" columns.
  if (url.searchParams.get('rastreo') === '1') {
    return rastreoHandler(url);
  }

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

  // Block 08: cross-week query — winbacks only. No pay_week required.
  if (url.searchParams.get('winback_only') === '1') {
    const fromDate = url.searchParams.get('from');
    const toDate = url.searchParams.get('to');
    const campaign = url.searchParams.get('campaign'); // D2D | RETAIL — matched against plan_mapping.campaign
    const agentId = url.searchParams.get('agent_id');

    let q = supabase
      .from('payroll_sales')
      .select('*')
      .eq('is_winback', true)
      .order('contract_signed_date', { ascending: false, nullsFirst: false })
      .limit(500);
    if (fromDate) q = q.gte('contract_signed_date', fromDate);
    if (toDate) q = q.lte('contract_signed_date', toDate);
    if (agentId) q = q.eq('internal_agent_id', agentId);

    const { data: wbSales, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const wbAgentIds = Array.from(new Set((wbSales ?? []).map((s) => s.internal_agent_id).filter((id): id is string => !!id)));
    const wbMappingIds = Array.from(new Set((wbSales ?? []).map((s) => s.plan_mapping_id).filter((id): id is string => !!id)));
    const [{ data: wbAgents }, { data: wbMappings }] = await Promise.all([
      wbAgentIds.length > 0
        ? supabase.from('users').select('id, name').in('id', wbAgentIds)
        : Promise.resolve({ data: [] }),
      wbMappingIds.length > 0
        ? supabase.from('plan_mappings').select('id, plan_name, plan_type, campaign').in('id', wbMappingIds)
        : Promise.resolve({ data: [] }),
    ]);
    const wbAgentMap = new Map((wbAgents ?? []).map((a) => [a.id, a.name]));
    const wbMappingMap = new Map((wbMappings ?? []).map((m) => [m.id, m]));
    const filtered = (wbSales ?? []).filter((s) => {
      if (!campaign) return true;
      const m = s.plan_mapping_id ? wbMappingMap.get(s.plan_mapping_id) : null;
      return m?.campaign === campaign;
    });
    return NextResponse.json({
      sales: filtered.map((s) => ({
        ...s,
        agent_name: s.internal_agent_id ? wbAgentMap.get(s.internal_agent_id) ?? null : null,
        plan_mapping: s.plan_mapping_id ? wbMappingMap.get(s.plan_mapping_id) ?? null : null,
      })),
    });
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

async function rastreoHandler(url: URL): Promise<NextResponse> {
  const exportMode = url.searchParams.get('export');
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));

  const contractId = url.searchParams.get('contract_id')?.trim() ?? '';
  const customer = url.searchParams.get('customer')?.trim() ?? '';
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const agentId = url.searchParams.get('agent_id');
  const managerId = url.searchParams.get('manager_id');
  const campaign = url.searchParams.get('campaign');
  const planName = url.searchParams.get('plan');
  const statusParam = url.searchParams.get('status') ?? '';
  const payWeek = url.searchParams.get('pay_week');
  const sourceFile = url.searchParams.get('source_file');
  const isWinback = url.searchParams.get('is_winback');
  const q = url.searchParams.get('q')?.trim() ?? '';

  // Pre-resolve plan_mapping_ids when filtering by campaign (no FK join in PostgREST
  // without an explicit relation, so we batch).
  let campaignMappingIds: string[] | null = null;
  if (campaign) {
    const { data: maps } = await supabase
      .from('plan_mappings')
      .select('id')
      .eq('campaign', campaign);
    campaignMappingIds = (maps ?? []).map((m) => m.id);
    if (campaignMappingIds.length === 0) {
      return NextResponse.json({ rows: [], total: 0, page, page_size: RASTREO_PAGE_SIZE });
    }
  }

  // Pre-resolve sales touched by a given manager (via payfile_overrides).
  let saleIdsByManager: string[] | null = null;
  if (managerId) {
    const { data: ovs } = await supabase
      .from('payfile_overrides')
      .select('sale_id')
      .eq('manager_id', managerId);
    saleIdsByManager = Array.from(new Set((ovs ?? []).map((o) => o.sale_id)));
    if (saleIdsByManager.length === 0) {
      return NextResponse.json({ rows: [], total: 0, page, page_size: RASTREO_PAGE_SIZE });
    }
  }

  let query = supabase
    .from('payroll_sales')
    .select('*', { count: 'exact' })
    .order('contract_signed_date', { ascending: false, nullsFirst: false });

  if (contractId) query = query.ilike('contract_id', `%${contractId}%`);
  if (customer) query = query.ilike('customer_name', `%${customer}%`);
  if (from) query = query.gte('contract_signed_date', from);
  if (to) query = query.lte('contract_signed_date', to);
  if (agentId) query = query.eq('internal_agent_id', agentId);
  if (planName) query = query.ilike('plan_name', `%${planName}%`);
  if (sourceFile) query = query.ilike('source_file_name', `%${sourceFile}%`);
  if (payWeek) query = query.eq('pay_week', payWeek);
  if (isWinback === '1') query = query.eq('is_winback', true);
  else if (isWinback === '0') query = query.eq('is_winback', false);
  if (statusParam) {
    const list = statusParam.split(',').map((s) => s.trim())
      .filter((s) => (SALE_STATUSES as readonly string[]).includes(s)) as SaleStatus[];
    if (list.length > 0) query = query.in('status', list);
  }
  if (campaignMappingIds) query = query.in('plan_mapping_id', campaignMappingIds);
  if (saleIdsByManager) query = query.in('id', saleIdsByManager);
  if (q) {
    const escaped = q.replace(/[%_]/g, (m) => `\\${m}`);
    query = query.or([
      `contract_id.ilike.%${escaped}%`,
      `customer_name.ilike.%${escaped}%`,
      `plan_name.ilike.%${escaped}%`,
      `je_badge.ilike.%${escaped}%`,
      `source_file_name.ilike.%${escaped}%`,
    ].join(','));
  }

  if (exportMode === 'csv') {
    query = query.range(0, RASTREO_EXPORT_CAP - 1);
  } else {
    const fromIdx = (page - 1) * RASTREO_PAGE_SIZE;
    query = query.range(fromIdx, fromIdx + RASTREO_PAGE_SIZE - 1);
  }

  const { data: rows, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Hydrate agent + plan_mapping + overrides (for the 3 manager columns) +
  // payfile (for the "Payfile ID" / link column).
  const saleIds = (rows ?? []).map((r) => r.id);
  const agentIds = Array.from(new Set((rows ?? []).map((r) => r.internal_agent_id).filter((v): v is string => !!v)));
  const mappingIds = Array.from(new Set((rows ?? []).map((r) => r.plan_mapping_id).filter((v): v is string => !!v)));

  const [{ data: agents }, { data: mappings }, { data: overrides }, { data: lineItems }] = await Promise.all([
    agentIds.length
      ? supabase.from('users').select('id, name').in('id', agentIds)
      : Promise.resolve({ data: [] }),
    mappingIds.length
      ? supabase.from('plan_mappings').select('id, plan_name, plan_type, campaign, tier, term_months').in('id', mappingIds)
      : Promise.resolve({ data: [] }),
    saleIds.length
      ? supabase
          .from('payfile_overrides')
          .select('sale_id, manager_id, manager_level, amount')
          .in('sale_id', saleIds)
      : Promise.resolve({ data: [] }),
    saleIds.length
      ? supabase
          .from('payfile_line_items')
          .select('id, source_sale_id, payfile_id, amount, line_type')
          .in('source_sale_id', saleIds)
          .eq('line_type', 'COMMISSION')
      : Promise.resolve({ data: [] }),
  ]);

  const agentName = new Map((agents ?? []).map((u) => [u.id, u.name]));
  const mappingById = new Map((mappings ?? []).map((m) => [m.id, m]));

  // Manager hydration: collect every manager_id we'll need and look up names
  // in a single query.
  const allManagerIds = Array.from(new Set((overrides ?? []).map((o) => (o as { manager_id: string }).manager_id)));
  const { data: managers } = allManagerIds.length
    ? await supabase.from('users').select('id, name').in('id', allManagerIds)
    : { data: [] };
  const managerName = new Map((managers ?? []).map((u) => [u.id, u.name]));

  // Build per-sale manager-by-level map.
  type LevelEntry = { id: string; name: string | null; amount: number };
  const overridesBySale = new Map<string, Record<'MANAGER_1' | 'MANAGER_2' | 'MANAGER_3', LevelEntry | null>>();
  for (const o of overrides ?? []) {
    const oo = o as { sale_id: string; manager_id: string; manager_level: 'MANAGER_1' | 'MANAGER_2' | 'MANAGER_3'; amount: number };
    const slot = overridesBySale.get(oo.sale_id) ?? { MANAGER_1: null, MANAGER_2: null, MANAGER_3: null };
    slot[oo.manager_level] = {
      id: oo.manager_id,
      name: managerName.get(oo.manager_id) ?? null,
      amount: Number(oo.amount),
    };
    overridesBySale.set(oo.sale_id, slot);
  }

  // payfile_id for the agent's commission line (gives the user a direct link).
  const lineBySale = new Map<string, { payfile_id: string; amount: number }>();
  for (const l of lineItems ?? []) {
    const ll = l as { source_sale_id: string; payfile_id: string; amount: number };
    if (ll.source_sale_id && !lineBySale.has(ll.source_sale_id)) {
      lineBySale.set(ll.source_sale_id, { payfile_id: ll.payfile_id, amount: Number(ll.amount) });
    }
  }

  const decorated = (rows ?? []).map((r) => {
    const mapping = r.plan_mapping_id ? mappingById.get(r.plan_mapping_id) : null;
    const managers = overridesBySale.get(r.id) ?? { MANAGER_1: null, MANAGER_2: null, MANAGER_3: null };
    const agentLine = lineBySale.get(r.id) ?? null;
    return {
      ...r,
      agent_name: r.internal_agent_id ? agentName.get(r.internal_agent_id) ?? null : null,
      plan_mapping: mapping,
      managers,
      agent_payfile_id: agentLine?.payfile_id ?? null,
      computed_commission: agentLine?.amount ?? null,
    };
  });

  if (exportMode === 'csv') {
    const header = [
      'contract_id', 'customer_name', 'plan_name', 'plan_type', 'campaign',
      'je_badge', 'agent', 'manager_1', 'manager_2', 'manager_3',
      'contract_signed_date', 'pay_week', 'status', 'is_winback',
      'je_paid_amount', 'computed_commission', 'source_file_name',
    ];
    const lines = [header.join(',')];
    for (const r of decorated) {
      lines.push([
        csvField(r.contract_id),
        csvField(r.customer_name ?? ''),
        csvField(r.plan_name),
        r.plan_mapping?.plan_type ?? '',
        r.plan_mapping?.campaign ?? '',
        csvField(r.je_badge),
        csvField(r.agent_name ?? ''),
        csvField(r.managers.MANAGER_1?.name ?? ''),
        csvField(r.managers.MANAGER_2?.name ?? ''),
        csvField(r.managers.MANAGER_3?.name ?? ''),
        r.contract_signed_date ?? '',
        r.pay_week ?? '',
        r.status,
        r.is_winback ? 'true' : 'false',
        Number(r.je_paid_amount).toFixed(2),
        r.computed_commission !== null ? Number(r.computed_commission).toFixed(2) : '',
        csvField(r.source_file_name),
      ].join(','));
    }
    return new NextResponse(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="rastreo-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json({
    rows: decorated,
    total: count ?? 0,
    page,
    page_size: RASTREO_PAGE_SIZE,
  });
}

function csvField(v: string): string {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
