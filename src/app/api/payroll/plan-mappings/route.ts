import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { PLAN_TYPES, PLAN_CAMPAIGNS } from '@/lib/payroll/constants';
import { reprocessVerifyRowsForPlan, listPendingPlans } from '@/lib/payroll/planMapping';

/**
 * GET    /api/payroll/plan-mappings              → list all mappings
 * GET    /api/payroll/plan-mappings?pending=1    → list unique VERIFY plan_names
 * POST   /api/payroll/plan-mappings              → create mapping
 * PATCH  /api/payroll/plan-mappings              → update mapping
 *
 * Save-side validation per master plan §Plan Mapping:
 *   - plan_name unique
 *   - COMMISSION + campaign='D2D' → tier required (master plan rule, but we
 *     allow NULL on insert + flag it in canPublishWeek so admin can seed the
 *     mapping early and tag the tier later)
 *   - RCE_ADDER_* → extra_amount required
 *
 * Saving (create or PATCH with plan_type/campaign change) triggers
 * reprocessVerifyRowsForPlan() — every payroll_sales row currently sitting
 * on VERIFY with the same plan_name flips to its real status. The handler
 * returns the reprocessed count so the UI can display "X ventas resueltas".
 */

interface MappingBody {
  plan_name?: string;
  plan_type?: string;
  campaign?: string | null;
  tier?: number | null;
  term_months?: number | null;
  extra_amount?: number | null;
  notes?: string | null;
}

function validateBody(body: MappingBody, isCreate: boolean): string | null {
  if (isCreate && !body.plan_name?.trim()) return 'plan_name es requerido';
  if (isCreate && !body.plan_type) return 'plan_type es requerido';
  if (body.plan_type && !(PLAN_TYPES as readonly string[]).includes(body.plan_type)) {
    return `plan_type inválido. Debe ser uno de: ${PLAN_TYPES.join(', ')}`;
  }
  if (body.campaign && !(PLAN_CAMPAIGNS as readonly string[]).includes(body.campaign)) {
    return 'campaign debe ser D2D, RETAIL o BOTH';
  }
  if (body.tier !== undefined && body.tier !== null && (body.tier < 0 || body.tier > 4)) {
    return 'tier debe estar entre 0 y 4';
  }
  if (body.term_months !== undefined && body.term_months !== null && (body.term_months < 1 || body.term_months > 120)) {
    return 'term_months debe estar entre 1 y 120';
  }
  if (
    (body.plan_type === 'RCE_ADDER_D2D' || body.plan_type === 'RCE_ADDER_RETAIL') &&
    (body.extra_amount === undefined || body.extra_amount === null)
  ) {
    return 'extra_amount es requerido para RCE_ADDER_*';
  }
  return null;
}

export async function GET(req: NextRequest) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  if (url.searchParams.get('pending') === '1') {
    const pending = await listPendingPlans();
    return NextResponse.json(pending);
  }

  const { data, error } = await supabase
    .from('plan_mappings')
    .select('id, plan_name, plan_type, tier, term_months, campaign, extra_amount, notes, created_by, created_at, updated_at')
    .order('plan_name', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body: MappingBody = await req.json();
  const validationError = validateBody(body, true);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  const { data, error } = await supabase
    .from('plan_mappings')
    .insert({
      plan_name: body.plan_name!.trim(),
      plan_type: body.plan_type,
      campaign: body.campaign ?? null,
      tier: body.tier ?? null,
      term_months: body.term_months ?? null,
      extra_amount: body.extra_amount ?? null,
      notes: body.notes ?? null,
      created_by: session.user.id,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Ya existe un mapeo con ese Plan Name.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Auto-reprocess any VERIFY rows that match this plan_name.
  const reprocessed = await reprocessVerifyRowsForPlan(data.plan_name);

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'plan_mapping',
    entity_id: data.id,
    action: 'CREATE',
    actor_id: session.user.id,
    new_value: data,
    change_notes: reprocessed > 0 ? `Reprocesadas ${reprocessed} ventas VERIFY` : null,
  });

  return NextResponse.json({ mapping: data, reprocessed }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, ...updates }: { id?: string } & MappingBody = await req.json();
  if (!id) return NextResponse.json({ error: 'id es requerido' }, { status: 400 });

  const validationError = validateBody(updates, false);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  // Fetch before image for audit log + plan_name pin (plan_name is the key
  // used for reprocessing; we don't allow it to change via PATCH).
  const { data: before, error: beforeErr } = await supabase
    .from('plan_mappings')
    .select('*')
    .eq('id', id)
    .single();
  if (beforeErr || !before) {
    return NextResponse.json({ error: 'Mapeo no encontrado' }, { status: 404 });
  }

  const patch: Record<string, unknown> = {};
  if (updates.plan_type !== undefined) patch.plan_type = updates.plan_type;
  if (updates.campaign !== undefined) patch.campaign = updates.campaign;
  if (updates.tier !== undefined) patch.tier = updates.tier;
  if (updates.term_months !== undefined) patch.term_months = updates.term_months;
  if (updates.extra_amount !== undefined) patch.extra_amount = updates.extra_amount;
  if (updates.notes !== undefined) patch.notes = updates.notes;

  const { data, error } = await supabase
    .from('plan_mappings')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If plan_type changed we run a reprocess pass — VERIFY rows for this
  // plan_name pick up the new mapping.
  const reprocessed =
    before.plan_type !== data.plan_type
      ? await reprocessVerifyRowsForPlan(data.plan_name)
      : 0;

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'plan_mapping',
    entity_id: id,
    action: 'UPDATE',
    actor_id: session.user.id,
    old_value: before,
    new_value: data,
    change_notes: reprocessed > 0 ? `Reprocesadas ${reprocessed} ventas VERIFY` : null,
  });

  return NextResponse.json({ mapping: data, reprocessed });
}
