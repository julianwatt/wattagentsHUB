import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { SALE_STATUSES, type SaleStatus } from '@/lib/payroll/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteCtx { params: Promise<{ id: string }> }

/**
 * GET /api/payroll/sales/[id]
 *
 * Full detail view for the Rastreo de Ventas drawer (block 14):
 *   - the raw sale row + every column from the JE upload (raw_row)
 *   - resolved plan_mapping
 *   - resolved internal agent + 3-tier manager hierarchy at the time the
 *     row was processed (via the override line items)
 *   - line items linked to this sale (agent commission + manager overrides)
 *   - prior appearances of the same contract_id (winback chain)
 *   - audit log entries pointing at this sale row
 */
export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const { data: sale } = await supabase
    .from('payroll_sales')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!sale) return NextResponse.json({ error: 'Venta no encontrada.' }, { status: 404 });

  const [
    { data: mapping },
    { data: agent },
    { data: overrides },
    { data: lineItems },
    { data: chain },
    { data: auditEntries },
  ] = await Promise.all([
    sale.plan_mapping_id
      ? supabase.from('plan_mappings').select('id, plan_name, plan_type, tier, term_months, campaign, extra_amount').eq('id', sale.plan_mapping_id).maybeSingle()
      : Promise.resolve({ data: null }),
    sale.internal_agent_id
      ? supabase.from('users').select('id, name, username, role').eq('id', sale.internal_agent_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('payfile_overrides')
      .select('id, manager_id, manager_level, amount, original_amount, payfile_line_item_id')
      .eq('sale_id', id),
    supabase
      .from('payfile_line_items')
      .select('id, payfile_id, line_type, description, amount, original_amount, is_manually_edited')
      .or(`source_sale_id.eq.${id}`),
    sale.contract_id
      ? supabase
          .from('payroll_sales')
          .select('id, contract_id, status, pay_week, je_paid_amount, contract_signed_date, source_file_name, is_winback')
          .eq('contract_id', sale.contract_id)
          .neq('id', id)
          .order('contract_signed_date', { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase
      .from('payroll_audit_log')
      .select('*')
      .eq('entity_type', 'payroll_sale')
      .eq('entity_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  // Resolve manager names for overrides + payfile owners for the line items.
  const managerIds = Array.from(new Set((overrides ?? []).map((o) => (o as { manager_id: string }).manager_id)));
  const payfileIds = Array.from(new Set((lineItems ?? []).map((l) => (l as { payfile_id: string }).payfile_id)));
  const [{ data: managers }, { data: payfiles }] = await Promise.all([
    managerIds.length
      ? supabase.from('users').select('id, name, role').in('id', managerIds)
      : Promise.resolve({ data: [] }),
    payfileIds.length
      ? supabase.from('payfiles').select('id, user_id, pay_week, state').in('id', payfileIds)
      : Promise.resolve({ data: [] }),
  ]);
  const managerById = new Map((managers ?? []).map((u) => [u.id, u]));
  const payfileById = new Map((payfiles ?? []).map((p) => [(p as { id: string }).id, p]));
  const payfileOwnerIds = Array.from(new Set((payfiles ?? []).map((p) => (p as { user_id: string }).user_id)));
  const { data: payfileOwners } = payfileOwnerIds.length
    ? await supabase.from('users').select('id, name').in('id', payfileOwnerIds)
    : { data: [] };
  const ownerById = new Map((payfileOwners ?? []).map((u) => [u.id, u]));

  return NextResponse.json({
    sale,
    plan_mapping: mapping,
    agent,
    managers: (overrides ?? []).map((o) => ({
      manager_level: (o as { manager_level: string }).manager_level,
      manager_id: (o as { manager_id: string }).manager_id,
      manager_name: managerById.get((o as { manager_id: string }).manager_id)?.name ?? null,
      amount: Number((o as { amount: number }).amount),
      original_amount: Number((o as { original_amount: number }).original_amount),
      payfile_line_item_id: (o as { payfile_line_item_id: string | null }).payfile_line_item_id,
    })),
    line_items: (lineItems ?? []).map((l) => {
      const pf = payfileById.get((l as { payfile_id: string }).payfile_id);
      return {
        ...l,
        payfile: pf
          ? {
              id: pf.id,
              owner_id: (pf as { user_id: string }).user_id,
              owner_name: ownerById.get((pf as { user_id: string }).user_id)?.name ?? null,
              pay_week: (pf as { pay_week: string }).pay_week,
              state: (pf as { state: string }).state,
            }
          : null,
      };
    }),
    chain: chain ?? [],
    audit_entries: auditEntries ?? [],
  });
}

/**
 * PATCH /api/payroll/sales/[id]
 *
 * Admin/CEO surgical edits on a parsed sale row:
 *   - status     → SaleStatus enum (e.g. PAYABLE → CANCELLED)
 *   - internal_agent_id → reassign to a different user
 *   - notes      → free-text annotation
 *
 * Anything else (contract_id, plan_name, etc.) is sourced from the JE file
 * and is intentionally immutable; re-upload the row to change those.
 *
 * Every mutation lands an audit log entry with before/after so the trail
 * is reconstructable.
 */
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json();

  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (!(SALE_STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: 'status inválido' }, { status: 400 });
    }
    patch.status = body.status as SaleStatus;
  }
  if (body.internal_agent_id !== undefined) {
    patch.internal_agent_id = body.internal_agent_id || null;
  }
  if (body.notes !== undefined) {
    patch.notes = typeof body.notes === 'string' ? body.notes : null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Sin cambios.' }, { status: 400 });
  }

  const { data: before } = await supabase
    .from('payroll_sales')
    .select('id, status, internal_agent_id, notes, contract_id, pay_week')
    .eq('id', id)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: 'Venta no encontrada.' }, { status: 404 });

  // Sales already attached to a published pay_week shouldn't have their
  // status flipped silently — those represent commitments on a published
  // payfile. The UI gates this, the API double-checks.
  if (patch.status && (before as { pay_week: string | null }).pay_week) {
    const week = (before as { pay_week: string | null }).pay_week;
    return NextResponse.json(
      { error: `Esta venta ya está atada a la semana ${week}. Reabre el payfile antes de cambiar su estado.` },
      { status: 409 },
    );
  }

  const { data: updated, error } = await supabase
    .from('payroll_sales')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const action = patch.status && (before as { status: string }).status !== patch.status
    ? 'STATE_CHANGE'
    : 'UPDATE';

  const oldSnap: Record<string, unknown> = {};
  const newSnap: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) {
    oldSnap[k] = (before as Record<string, unknown>)[k] ?? null;
    newSnap[k] = patch[k] ?? null;
  }

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'payroll_sale',
    entity_id: id,
    action,
    actor_id: session.user.id,
    old_value: oldSnap,
    new_value: newSnap,
    change_notes: action === 'STATE_CHANGE'
      ? `Status ${oldSnap.status} → ${newSnap.status} (contract ${(before as { contract_id: string }).contract_id})`
      : null,
  });

  return NextResponse.json(updated);
}
