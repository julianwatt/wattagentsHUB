import { NextRequest, NextResponse } from 'next/server';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { withdrawCollection } from '@/lib/payroll/negativeBalances';
import { supabase } from '@/lib/supabase';
import { EDITABLE_PAYFILE_STATES, type PayfileState } from '@/lib/payroll/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteCtx { params: Promise<{ id: string }> }

/**
 * POST /api/payroll/payfile-line-items/[id]/withdraw-collection
 *
 * "Quitar este cobro" action. Removes a NEGATIVE_BALANCE_COLLECTION line
 * item and reverts the linked negative_balances.collected_amount /
 * remaining_amount / status. Audit log captures the reversal.
 *
 * Admin/CEO only. Refuses on non-editable payfile states.
 */
export async function POST(_req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;

  // State guard.
  const { data: row } = await supabase
    .from('payfile_line_items')
    .select('id, payfiles!inner(state)')
    .eq('id', id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'Line item no encontrado.' }, { status: 404 });
  const pf = (row as { payfiles?: unknown }).payfiles;
  const state = Array.isArray(pf)
    ? (pf[0] as { state?: PayfileState } | undefined)?.state
    : (pf as { state?: PayfileState } | undefined)?.state;
  if (state && !(EDITABLE_PAYFILE_STATES as readonly PayfileState[]).includes(state)) {
    return NextResponse.json({ error: `Payfile en estado ${state}, no editable.` }, { status: 409 });
  }

  const result = await withdrawCollection(id, session.user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
