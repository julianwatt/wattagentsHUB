import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { editLineItem } from '@/lib/payroll/calculatePayfile';
import { EDITABLE_PAYFILE_STATES, type PayfileState } from '@/lib/payroll/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * Supabase-js returns embedded relations as an array even when the FK
 * cardinality is "one". Normalise both shapes to the single nested object.
 */
function extractPayfileState(row: unknown): PayfileState | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const pf = (row as { payfiles?: unknown }).payfiles;
  if (Array.isArray(pf)) return (pf[0] as { state?: PayfileState } | undefined)?.state;
  return (pf as { state?: PayfileState } | undefined)?.state;
}

/**
 * PATCH /api/payroll/payfile-line-items/[id]
 *
 * Body: { amount: number, edit_note: string }
 * Applies the 3× rule. If admin edits past 3× → requires_ceo_approval=true.
 * CEO edits never set the approval flag; admin notes show a warning in UI.
 */
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json();
  const { amount, edit_note } = body as { amount?: number; edit_note?: string | null };
  if (amount === undefined || Number.isNaN(Number(amount))) {
    return NextResponse.json({ error: 'amount es requerido y debe ser numérico.' }, { status: 400 });
  }

  // Editable-state guard.
  const { data: row } = await supabase
    .from('payfile_line_items')
    .select('id, payfile_id, payfiles!inner(state)')
    .eq('id', id)
    .maybeSingle();
  const state = extractPayfileState(row);
  if (state && !(EDITABLE_PAYFILE_STATES as readonly PayfileState[]).includes(state)) {
    return NextResponse.json(
      { error: `Payfile en estado ${state}, no se puede editar.` },
      { status: 409 },
    );
  }

  const result = await editLineItem({
    line_item_id: id,
    new_amount: Number(amount),
    edit_note: edit_note ?? null,
    editor_id: session.user.id,
    editor_role: session.user.role ?? 'admin',
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'edit failed' }, { status: 500 });
  }
  return NextResponse.json(result);
}

/**
 * DELETE /api/payroll/payfile-line-items/[id]
 *
 * Only manually-added rows can be deleted. Auto-generated rows are removed
 * by the next recalc — deleting them piecemeal would corrupt the source-of-
 * truth derivation.
 */
export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;

  const { data: row } = await supabase
    .from('payfile_line_items')
    .select('id, payfile_id, is_manually_added, payfiles!inner(state)')
    .eq('id', id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'Line item no encontrado.' }, { status: 404 });
  const state = extractPayfileState(row);
  if (state && !(EDITABLE_PAYFILE_STATES as readonly PayfileState[]).includes(state)) {
    return NextResponse.json(
      { error: `Payfile en estado ${state}, no se puede editar.` },
      { status: 409 },
    );
  }
  if (!(row as { is_manually_added: boolean }).is_manually_added) {
    return NextResponse.json(
      { error: 'Sólo líneas agregadas manualmente pueden eliminarse. Las auto-generadas se regeneran al recalcular.' },
      { status: 403 },
    );
  }

  const { error } = await supabase.from('payfile_line_items').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Recompute total.
  const { data } = await supabase
    .from('payfile_line_items')
    .select('amount')
    .eq('payfile_id', (row as { payfile_id: string }).payfile_id);
  const total = (data ?? []).reduce((acc, r) => acc + Number(r.amount), 0);
  await supabase
    .from('payfiles')
    .update({ total_amount: total })
    .eq('id', (row as { payfile_id: string }).payfile_id);

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'payfile_line_item',
    entity_id: id,
    action: 'DELETE',
    actor_id: session.user.id,
    change_notes: 'Manualmente eliminado',
  });

  return NextResponse.json({ ok: true });
}
