import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { D2D_TERM_MONTHS, ROSTER_CAMPAIGNS } from '@/lib/payroll/constants';

/**
 * POST /api/payroll/roster/custom-rates
 * PATCH /api/payroll/roster/custom-rates  (id required)
 * DELETE /api/payroll/roster/custom-rates  (id required)
 *
 * Validations enforced server-side (the UI mirrors them for UX):
 *   - valid_from <= valid_until
 *   - no overlapping active row for the same (user, campaign, tier, term)
 *   - D2D rows: tier 0–4; term 36 | 60 (or NULL = applies to any term of
 *     that tier, per master plan §Tarifas custom)
 *   - Retail rows: tier and term_months must be NULL
 */

interface RatePayload {
  user_id?: string;
  campaign?: string;
  tier?: number | null;
  term_months?: number | null;
  commission_amount?: number;
  override_amount?: number | null;
  valid_from?: string;
  valid_until?: string | null;
}

function validate(payload: RatePayload, isCreate: boolean): string | null {
  if (isCreate) {
    if (!payload.user_id) return 'user_id es requerido';
    if (!payload.campaign) return 'campaign es requerido';
    if (payload.commission_amount === undefined || payload.commission_amount === null) {
      return 'commission_amount es requerido';
    }
    if (!payload.valid_from) return 'valid_from es requerido';
  }
  if (payload.campaign && !(ROSTER_CAMPAIGNS as readonly string[]).includes(payload.campaign)) {
    return 'campaign debe ser D2D o RETAIL';
  }
  if (payload.campaign === 'RETAIL') {
    if (payload.tier !== undefined && payload.tier !== null) {
      return 'Retail rates no tienen tier';
    }
    if (payload.term_months !== undefined && payload.term_months !== null) {
      return 'Retail rates no tienen term';
    }
  }
  if (payload.campaign === 'D2D' && payload.tier !== undefined && payload.tier !== null) {
    if (payload.tier < 0 || payload.tier > 4) return 'tier debe estar entre 0 y 4';
  }
  if (
    payload.term_months !== undefined && payload.term_months !== null &&
    !(D2D_TERM_MONTHS as readonly number[]).includes(payload.term_months)
  ) {
    return 'term_months debe ser 36 o 60';
  }
  if (payload.valid_from && payload.valid_until && payload.valid_until < payload.valid_from) {
    return 'valid_until no puede ser anterior a valid_from';
  }
  return null;
}

/** Returns true when [aFrom, aUntil] overlaps [bFrom, bUntil] (open-ended). */
function periodsOverlap(
  aFrom: string, aUntil: string | null,
  bFrom: string, bUntil: string | null,
): boolean {
  const aEnd = aUntil ?? '9999-12-31';
  const bEnd = bUntil ?? '9999-12-31';
  return aFrom <= bEnd && bFrom <= aEnd;
}

export async function POST(req: NextRequest) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body: RatePayload = await req.json();
  const validationError = validate(body, true);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  // Overlap check: any existing row for same (user, campaign, tier, term)
  // whose date range overlaps the new row blocks the insert.
  const { data: existing, error: existingErr } = await supabase
    .from('roster_custom_rates')
    .select('id, valid_from, valid_until, tier, term_months')
    .eq('user_id', body.user_id!)
    .eq('campaign', body.campaign!);
  if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });

  const sameKey = (existing ?? []).filter(
    (r) =>
      (r.tier ?? null) === (body.tier ?? null) &&
      (r.term_months ?? null) === (body.term_months ?? null),
  );
  for (const r of sameKey) {
    if (periodsOverlap(body.valid_from!, body.valid_until ?? null, r.valid_from, r.valid_until)) {
      return NextResponse.json(
        { error: 'Ya existe una tarifa custom activa para esta combinación en el periodo dado.' },
        { status: 409 },
      );
    }
  }

  const { data, error } = await supabase
    .from('roster_custom_rates')
    .insert({
      user_id: body.user_id,
      campaign: body.campaign,
      tier: body.tier ?? null,
      term_months: body.term_months ?? null,
      commission_amount: body.commission_amount,
      override_amount: body.override_amount ?? null,
      valid_from: body.valid_from,
      valid_until: body.valid_until ?? null,
      created_by: session.user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'custom_rate',
    entity_id: data.id,
    action: 'CREATE',
    actor_id: session.user.id,
    new_value: data,
    change_notes: `Tarifa custom ${body.campaign}${body.tier !== null && body.tier !== undefined ? ` tier ${body.tier}` : ''}${body.term_months ? ` ${body.term_months}m` : ''} = $${body.commission_amount}`,
  });

  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, ...updates }: { id?: string } & RatePayload = await req.json();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const validationError = validate(updates, false);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (updates.commission_amount !== undefined) patch.commission_amount = updates.commission_amount;
  if (updates.override_amount !== undefined) patch.override_amount = updates.override_amount;
  if (updates.valid_from !== undefined) patch.valid_from = updates.valid_from;
  if (updates.valid_until !== undefined) patch.valid_until = updates.valid_until;
  if (updates.tier !== undefined) patch.tier = updates.tier;
  if (updates.term_months !== undefined) patch.term_months = updates.term_months;
  if (updates.campaign !== undefined) patch.campaign = updates.campaign;

  const { data: before } = await supabase
    .from('roster_custom_rates')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  const { data, error } = await supabase
    .from('roster_custom_rates')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'custom_rate',
    entity_id: id,
    action: 'UPDATE',
    actor_id: session.user.id,
    old_value: before,
    new_value: patch,
  });

  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { data: before } = await supabase
    .from('roster_custom_rates')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  const { error } = await supabase.from('roster_custom_rates').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (before) {
    await supabase.from('payroll_audit_log').insert({
      entity_type: 'custom_rate',
      entity_id: id,
      action: 'DELETE',
      actor_id: session.user.id,
      old_value: before,
    });
  }

  return NextResponse.json({ success: true });
}
