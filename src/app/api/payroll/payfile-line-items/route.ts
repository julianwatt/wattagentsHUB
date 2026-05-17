import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { PAYFILE_LINE_TYPES, EDITABLE_PAYFILE_STATES, type PayfileLineType, type PayfileState } from '@/lib/payroll/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/payroll/payfile-line-items
 *
 * Adds a manual line item to an existing payfile. Used for one-off
 * adjustments admin / CEO want to surface in this week. Marks
 * is_manually_added=true so the next recalc preserves it.
 *
 * Body:
 *   payfile_id, line_type, description, amount, source_sale_id (optional),
 *   edit_note (optional).
 */
export async function POST(req: NextRequest) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { payfile_id, line_type, description, amount, source_sale_id, edit_note } = body as {
    payfile_id?: string;
    line_type?: string;
    description?: string;
    amount?: number;
    source_sale_id?: string | null;
    edit_note?: string | null;
  };

  if (!payfile_id || !line_type || !description || amount === undefined) {
    return NextResponse.json(
      { error: 'payfile_id, line_type, description y amount son requeridos.' },
      { status: 400 },
    );
  }
  if (!(PAYFILE_LINE_TYPES as readonly string[]).includes(line_type)) {
    return NextResponse.json({ error: 'line_type inválido.' }, { status: 400 });
  }

  // Refuse if the payfile is past the editable states.
  const { data: payfile } = await supabase
    .from('payfiles')
    .select('id, state')
    .eq('id', payfile_id)
    .maybeSingle();
  if (!payfile) return NextResponse.json({ error: 'payfile no encontrado.' }, { status: 404 });
  if (!(EDITABLE_PAYFILE_STATES as readonly PayfileState[]).includes((payfile as { state: PayfileState }).state)) {
    return NextResponse.json(
      { error: `Payfile en estado ${payfile.state}, no se puede editar.` },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from('payfile_line_items')
    .insert({
      payfile_id,
      line_type: line_type as PayfileLineType,
      description,
      source_sale_id: source_sale_id ?? null,
      amount,
      original_amount: amount,
      is_manually_added: true,
      edit_note: edit_note || null,
      edited_by: session.user.id,
      edited_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 500 });

  await recomputeTotal(payfile_id);

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'payfile_line_item',
    entity_id: data.id,
    action: 'CREATE',
    actor_id: session.user.id,
    new_value: data,
    change_notes: 'Manualmente agregado',
  });

  return NextResponse.json(data, { status: 201 });
}

async function recomputeTotal(payfileId: string) {
  const { data } = await supabase
    .from('payfile_line_items')
    .select('amount')
    .eq('payfile_id', payfileId);
  const total = (data ?? []).reduce((acc, r) => acc + Number(r.amount), 0);
  await supabase.from('payfiles').update({ total_amount: total }).eq('id', payfileId);
}
