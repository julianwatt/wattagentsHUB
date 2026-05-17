import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { MANAGER_LEVELS, EDITABLE_PAYFILE_STATES, type ManagerLevel, type PayfileState } from '@/lib/payroll/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/payroll/payfile-overrides
 *
 * Adds a manager override row + the corresponding payfile_line_item in the
 * manager's payfile. Used by the "Agregar manager" flow when the auto-
 * calculated hierarchy missed somebody who should have received an
 * override.
 *
 * Body:
 *   sale_id, manager_user_id, manager_level (MANAGER_1..3), amount,
 *   description (optional, defaults to "Override manual ..."),
 *   pay_week (required so we know which payfile to attach to).
 */
export async function POST(req: NextRequest) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { sale_id, manager_user_id, manager_level, amount, description, pay_week } = body as {
    sale_id?: string;
    manager_user_id?: string;
    manager_level?: string;
    amount?: number;
    description?: string;
    pay_week?: string;
  };

  if (!sale_id || !manager_user_id || !manager_level || amount === undefined || !pay_week) {
    return NextResponse.json(
      { error: 'sale_id, manager_user_id, manager_level, amount y pay_week son requeridos.' },
      { status: 400 },
    );
  }
  if (!(MANAGER_LEVELS as readonly string[]).includes(manager_level)) {
    return NextResponse.json({ error: 'manager_level inválido.' }, { status: 400 });
  }

  // Find or create the manager's payfile for this week.
  const { data: existingPf } = await supabase
    .from('payfiles')
    .select('id, state')
    .eq('user_id', manager_user_id)
    .eq('pay_week', pay_week)
    .maybeSingle();
  let payfileId: string;
  let payfileState: PayfileState;
  if (existingPf) {
    payfileId = (existingPf as { id: string }).id;
    payfileState = (existingPf as { state: PayfileState }).state;
  } else {
    const { data: created, error: cErr } = await supabase
      .from('payfiles')
      .insert({ user_id: manager_user_id, pay_week, state: 'DRAFT', total_amount: 0 })
      .select('id, state')
      .single();
    if (cErr || !created) return NextResponse.json({ error: cErr?.message ?? 'create payfile failed' }, { status: 500 });
    payfileId = (created as { id: string }).id;
    payfileState = (created as { state: PayfileState }).state;
  }

  if (!(EDITABLE_PAYFILE_STATES as readonly PayfileState[]).includes(payfileState)) {
    return NextResponse.json({ error: `Payfile en estado ${payfileState}, no editable.` }, { status: 409 });
  }

  // Insert the line item.
  const liDescription = description ?? `Override manual – sale ${sale_id}`;
  const { data: lineItem, error: liErr } = await supabase
    .from('payfile_line_items')
    .insert({
      payfile_id: payfileId,
      line_type: 'OVERRIDE',
      description: liDescription,
      source_sale_id: sale_id,
      amount,
      original_amount: amount,
      is_manually_added: true,
      edited_by: session.user.id,
      edited_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (liErr || !lineItem) return NextResponse.json({ error: liErr?.message ?? 'line item failed' }, { status: 500 });

  // Insert the override row.
  const { error: ovErr } = await supabase
    .from('payfile_overrides')
    .insert({
      sale_id,
      manager_id: manager_user_id,
      manager_level: manager_level as ManagerLevel,
      amount,
      original_amount: amount,
      is_manually_added: true,
      payfile_line_item_id: (lineItem as { id: string }).id,
    });
  if (ovErr) {
    if (ovErr.code === '23505') {
      return NextResponse.json(
        { error: `Ya existe un override en este sale para el nivel ${manager_level}.` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: ovErr.message }, { status: 500 });
  }

  // Recompute total.
  const { data: items } = await supabase
    .from('payfile_line_items')
    .select('amount')
    .eq('payfile_id', payfileId);
  const total = (items ?? []).reduce((acc, r) => acc + Number(r.amount), 0);
  await supabase.from('payfiles').update({ total_amount: total }).eq('id', payfileId);

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'payfile_override',
    entity_id: (lineItem as { id: string }).id,
    action: 'CREATE',
    actor_id: session.user.id,
    change_notes: `Manual override level=${manager_level} amount=${amount}`,
  });

  return NextResponse.json({ ok: true, payfile_id: payfileId }, { status: 201 });
}
