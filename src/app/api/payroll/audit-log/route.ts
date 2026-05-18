import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { AUDIT_ACTIONS, type AuditAction } from '@/lib/payroll/constants';
import { formatAuditEntry, type AuditLang, type AuditEntryContext } from '@/lib/payroll/auditHumanizer';
import type { PayrollAuditLog } from '@/types/payroll';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const EXPORT_HARD_CAP = 10_000;

/**
 * GET /api/payroll/audit-log
 *
 * Admin/CEO only. Returns a paginated, filtered slice of payroll_audit_log
 * with humanized descriptions per row.
 *
 * Query params (all optional):
 *   from, to         — created_at range, ISO date strings (default: last 7d)
 *   actor_id         — single actor UUID
 *   entity_type      — CSV list ("payfile,collection")
 *   action           — CSV list ("CREATE,UPDATE")
 *   entity_id        — exact match
 *   q                — free text search (ILIKE change_notes + entity_id)
 *   page             — 1-based page index, default 1
 *   export=csv       — return CSV instead of JSON (respects filters, cap 10k)
 */
export async function GET(req: NextRequest) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const exportMode = url.searchParams.get('export');
  const langParam = (url.searchParams.get('lang') === 'en' ? 'en' : 'es') as AuditLang;
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));

  // Default window: last 7 days.
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const from = url.searchParams.get('from') || defaultFrom;
  const to = url.searchParams.get('to') || now.toISOString().slice(0, 10);
  const actorId = url.searchParams.get('actor_id');
  const entityId = url.searchParams.get('entity_id');
  const q = url.searchParams.get('q')?.trim() ?? '';
  const entityTypes = (url.searchParams.get('entity_type') ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const actionsParam = (url.searchParams.get('action') ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean)
    .filter((a) => (AUDIT_ACTIONS as readonly string[]).includes(a)) as AuditAction[];

  // Build base query.
  let query = supabase
    .from('payroll_audit_log')
    .select('*', { count: 'exact' })
    .gte('created_at', `${from}T00:00:00Z`)
    .lte('created_at', `${to}T23:59:59Z`)
    .order('created_at', { ascending: false });

  if (actorId) query = query.eq('actor_id', actorId);
  if (entityId) query = query.eq('entity_id', entityId);
  if (entityTypes.length > 0) query = query.in('entity_type', entityTypes);
  if (actionsParam.length > 0) query = query.in('action', actionsParam);
  if (q) {
    // ILIKE on change_notes; entity_id exact-OR-ilike for UUID prefix.
    const escaped = q.replace(/[%_]/g, (m) => `\\${m}`);
    query = query.or(`change_notes.ilike.%${escaped}%,entity_id.ilike.%${escaped}%`);
  }

  // Pagination vs export.
  if (exportMode === 'csv') {
    query = query.range(0, EXPORT_HARD_CAP - 1);
  } else {
    const fromIdx = (page - 1) * PAGE_SIZE;
    query = query.range(fromIdx, fromIdx + PAGE_SIZE - 1);
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as PayrollAuditLog[];

  // Hydrate actor + small contextual lookups in batches.
  const actorIds = Array.from(new Set(rows.map((r) => r.actor_id).filter((v): v is string => !!v)));
  const payfileLineItemIds = Array.from(new Set(rows
    .filter((r) => r.entity_type === 'payfile_line_item')
    .map((r) => r.entity_id)));
  const payfileIds = Array.from(new Set(rows
    .filter((r) => r.entity_type === 'payfile')
    .map((r) => r.entity_id)));
  const versionIds = Array.from(new Set(rows
    .filter((r) => r.entity_type === 'payfile_version')
    .map((r) => r.entity_id)));
  const saleIds = Array.from(new Set(rows
    .filter((r) => r.entity_type === 'payroll_sale')
    .map((r) => r.entity_id)));

  const [
    { data: actors },
    { data: lineItems },
    { data: payfiles },
    { data: versions },
    { data: sales },
  ] = await Promise.all([
    actorIds.length
      ? supabase.from('users').select('id, name, role').in('id', actorIds)
      : Promise.resolve({ data: [] }),
    payfileLineItemIds.length
      ? supabase.from('payfile_line_items').select('id, payfile_id').in('id', payfileLineItemIds)
      : Promise.resolve({ data: [] }),
    payfileIds.length
      ? supabase.from('payfiles').select('id, user_id, pay_week').in('id', payfileIds)
      : Promise.resolve({ data: [] }),
    versionIds.length
      ? supabase.from('payfile_versions').select('id, payfile_id').in('id', versionIds)
      : Promise.resolve({ data: [] }),
    saleIds.length
      ? supabase.from('payroll_sales').select('id, contract_id').in('id', saleIds)
      : Promise.resolve({ data: [] }),
  ]);

  // Second hop: line-item → payfile → owner.
  const lineItemPayfileIds = Array.from(new Set((lineItems ?? []).map((l) => (l as { payfile_id: string }).payfile_id)));
  const versionPayfileIds = Array.from(new Set((versions ?? []).map((v) => (v as { payfile_id: string }).payfile_id)));
  const extraPayfileIds = Array.from(new Set([...lineItemPayfileIds, ...versionPayfileIds]
    .filter((id) => !payfileIds.includes(id))));
  const { data: extraPayfiles } = extraPayfileIds.length
    ? await supabase.from('payfiles').select('id, user_id, pay_week').in('id', extraPayfileIds)
    : { data: [] };
  const allPayfiles = [...(payfiles ?? []), ...(extraPayfiles ?? [])] as Array<{ id: string; user_id: string; pay_week: string }>;
  const ownerIds = Array.from(new Set(allPayfiles.map((p) => p.user_id)));
  const { data: owners } = ownerIds.length
    ? await supabase.from('users').select('id, name').in('id', ownerIds)
    : { data: [] };
  const ownerNameById = new Map((owners ?? []).map((u) => [u.id, u.name]));
  const payfileById = new Map(allPayfiles.map((p) => [p.id, p]));
  const lineItemPayfileById = new Map((lineItems ?? []).map((l) => [(l as { id: string }).id, (l as { payfile_id: string }).payfile_id]));
  const versionPayfileById = new Map((versions ?? []).map((v) => [(v as { id: string }).id, (v as { payfile_id: string }).payfile_id]));
  const saleContractById = new Map((sales ?? []).map((s) => [(s as { id: string }).id, (s as { contract_id: string }).contract_id]));
  const actorById = new Map((actors ?? []).map((u) => [u.id, u as { id: string; name: string; role: string }]));

  // Decorate rows with humanized description.
  const decorated = rows.map((r) => {
    const actor = r.actor_id ? actorById.get(r.actor_id) : null;
    const ctx: AuditEntryContext = {
      actor_name: actor?.name ?? null,
      actor_role: actor?.role ?? null,
    };
    if (r.entity_type === 'payfile') {
      const pf = payfileById.get(r.entity_id);
      if (pf) {
        ctx.payfile_owner_name = ownerNameById.get(pf.user_id) ?? null;
        ctx.payfile_pay_week = pf.pay_week;
      }
    }
    if (r.entity_type === 'payfile_line_item') {
      const pfId = lineItemPayfileById.get(r.entity_id);
      const pf = pfId ? payfileById.get(pfId) : null;
      if (pf) {
        ctx.line_item_owner_name = ownerNameById.get(pf.user_id) ?? null;
        ctx.line_item_pay_week = pf.pay_week;
      }
    }
    if (r.entity_type === 'payfile_version') {
      const pfId = versionPayfileById.get(r.entity_id);
      const pf = pfId ? payfileById.get(pfId) : null;
      if (pf) {
        ctx.payfile_owner_name = ownerNameById.get(pf.user_id) ?? null;
        ctx.payfile_pay_week = pf.pay_week;
      }
    }
    if (r.entity_type === 'payroll_sale') {
      ctx.sale_contract_id = saleContractById.get(r.entity_id) ?? null;
    }
    return {
      ...r,
      actor_name: ctx.actor_name,
      actor_role: ctx.actor_role,
      description: formatAuditEntry({ ...r, ...ctx } as Parameters<typeof formatAuditEntry>[0], langParam),
    };
  });

  if (exportMode === 'csv') {
    const header = ['created_at', 'actor', 'entity_type', 'action', 'description', 'entity_id', 'change_notes', 'old_value', 'new_value'];
    const lines = [header.join(',')];
    for (const r of decorated) {
      lines.push([
        r.created_at,
        csvField(r.actor_name ?? ''),
        r.entity_type,
        r.action,
        csvField(r.description),
        r.entity_id,
        csvField(r.change_notes ?? ''),
        csvField(JSON.stringify(r.old_value ?? null)),
        csvField(JSON.stringify(r.new_value ?? null)),
      ].join(','));
    }
    return new NextResponse(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="payroll-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json({
    rows: decorated,
    total: count ?? 0,
    page,
    page_size: PAGE_SIZE,
  });
}

function csvField(v: string): string {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
