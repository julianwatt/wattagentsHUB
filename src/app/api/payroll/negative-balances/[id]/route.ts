import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { deleteNegativeBalance } from '@/lib/payroll/negativeBalances';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteCtx { params: Promise<{ id: string }> }

/**
 * GET /api/payroll/negative-balances/[id]
 *
 * Returns the balance + the collection history (every line item that ever
 * referenced this balance, with the payfile it sat in).
 */
export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const { data: balance } = await supabase
    .from('negative_balances')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!balance) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 });

  const { data: collections } = await supabase
    .from('payfile_line_items')
    .select('id, payfile_id, amount, created_at, payfiles!inner(pay_week, state)')
    .eq('source_negative_balance_id', id)
    .eq('line_type', 'NEGATIVE_BALANCE_COLLECTION')
    .order('created_at', { ascending: true });

  return NextResponse.json({ balance, collections: collections ?? [] });
}

/**
 * PATCH /api/payroll/negative-balances/[id]
 *
 * Body: { description?: string }
 * Only notes/description edits are allowed via API. To "delete", use DELETE
 * which soft-deletes via status=MANUALLY_DELETED.
 */
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json();
  const patch: Record<string, unknown> = {};
  if (typeof body.description === 'string') patch.description = body.description.trim();
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Sin cambios.' }, { status: 400 });
  }

  const { data: before } = await supabase
    .from('negative_balances')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 });

  const { data, error } = await supabase
    .from('negative_balances')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'negative_balance',
    entity_id: id,
    action: 'UPDATE',
    actor_id: session.user.id,
    old_value: before,
    new_value: data,
  });

  return NextResponse.json(data);
}

/**
 * DELETE /api/payroll/negative-balances/[id]
 *
 * Body: { reason: string, confirm: 'ELIMINAR' }
 * Soft delete via status=MANUALLY_DELETED. Reason is mandatory and recorded
 * in audit log.
 */
export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const reason = String(body.reason ?? '').trim();
  const confirm = String(body.confirm ?? '').trim();

  if (confirm !== 'ELIMINAR') {
    return NextResponse.json({ error: 'Confirma escribiendo ELIMINAR.' }, { status: 400 });
  }
  const result = await deleteNegativeBalance(id, reason, session.user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true });
}
