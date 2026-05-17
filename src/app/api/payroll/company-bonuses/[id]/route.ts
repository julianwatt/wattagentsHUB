import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteCtx { params: Promise<{ id: string }> }

/**
 * GET /api/payroll/company-bonuses/[id]
 *
 * Returns the bonus + every bonus_distributions row (hydrated with the
 * recipient's name/role) + the underlying payroll_sales row when this
 * bonus came from an RCE adder.
 */
export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const { data: bonus } = await supabase
    .from('company_bonuses')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!bonus) return NextResponse.json({ error: 'Bono no encontrado.' }, { status: 404 });

  const { data: dists } = await supabase
    .from('bonus_distributions')
    .select('*')
    .eq('company_bonus_id', id)
    .order('created_at', { ascending: true });

  const recipientIds = Array.from(new Set((dists ?? []).map((d) => d.recipient_id).filter(Boolean)));
  const { data: users } = recipientIds.length
    ? await supabase.from('users').select('id, name, role, payroll_status').in('id', recipientIds)
    : { data: [] };
  const userById = new Map((users ?? []).map((u) => [u.id, u]));

  // For each distribution, locate the line item it produced (if any) so the
  // UI can show "applied" vs "pending" state.
  const distIds = (dists ?? []).map((d) => d.id);
  const { data: lineItems } = distIds.length
    ? await supabase
        .from('payfile_line_items')
        .select('id, payfile_id, amount, source_bonus_distribution_id, payfiles!inner(state, pay_week)')
        .in('source_bonus_distribution_id', distIds)
    : { data: [] };
  const liByDist = new Map<string, { payfile_id: string; state: string; pay_week: string; line_item_id: string }>();
  for (const li of (lineItems ?? [])) {
    const pf = (li as { payfiles?: unknown }).payfiles;
    const pfObj = Array.isArray(pf) ? pf[0] : pf;
    liByDist.set((li as { source_bonus_distribution_id: string }).source_bonus_distribution_id, {
      payfile_id: (li as { payfile_id: string }).payfile_id,
      line_item_id: (li as { id: string }).id,
      state: (pfObj as { state: string }).state,
      pay_week: (pfObj as { pay_week: string }).pay_week,
    });
  }

  // If the bonus came from a sale, surface its identifying fields.
  let source_sale: { id: string; contract_id: string; customer_name: string | null; plan_name: string; agent_id: string | null } | null = null;
  if ((bonus as { source_sale_id: string | null }).source_sale_id) {
    const { data: sale } = await supabase
      .from('payroll_sales')
      .select('id, contract_id, customer_name, plan_name, internal_agent_id')
      .eq('id', (bonus as { source_sale_id: string }).source_sale_id)
      .maybeSingle();
    if (sale) source_sale = {
      id: (sale as { id: string }).id,
      contract_id: (sale as { contract_id: string }).contract_id,
      customer_name: (sale as { customer_name: string | null }).customer_name,
      plan_name: (sale as { plan_name: string }).plan_name,
      agent_id: (sale as { internal_agent_id: string | null }).internal_agent_id,
    };
  }

  return NextResponse.json({
    bonus,
    source_sale,
    distributions: (dists ?? []).map((d) => ({
      ...d,
      recipient: userById.get(d.recipient_id) ?? null,
      applied_to_payfile: liByDist.get(d.id) ?? null,
    })),
  });
}

/**
 * PATCH /api/payroll/company-bonuses/[id]
 *
 * Body: { notes?: string }
 * Only the admin-editable notes column is mutable here. The JE-derived
 * description / total_amount / pay_week stay immutable.
 */
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json();
  const patch: Record<string, unknown> = {};
  if (typeof body.notes === 'string') patch.notes = body.notes;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Sin cambios.' }, { status: 400 });

  const { data: before } = await supabase.from('company_bonuses').select('*').eq('id', id).maybeSingle();
  if (!before) return NextResponse.json({ error: 'Bono no encontrado.' }, { status: 404 });

  const { error } = await supabase.from('company_bonuses').update(patch).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'company_bonus',
    entity_id: id,
    action: 'UPDATE',
    actor_id: session.user.id,
    old_value: before,
    new_value: patch,
  });
  return NextResponse.json({ ok: true });
}
