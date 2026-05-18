import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { ROSTER_CAMPAIGNS, ROSTER_POSITIONS } from '@/lib/payroll/constants';
import { reprocessSalesForBadge } from '@/lib/payroll/planMapping';

/**
 * POST /api/payroll/roster/badges  → create a JE badge for a user
 * PATCH /api/payroll/roster/badges → edit / inactivate an existing badge
 *
 * Active-badge uniqueness is enforced by the
 * `payroll_roster_badge_active_unique` partial-unique index from block 01:
 * an attempt to register a second active row for the same `je_badge`
 * returns Postgres 23505, which we surface as a friendly 409 message.
 */

export async function POST(req: NextRequest) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const {
    user_id, je_badge, valid_from, valid_until, campaign, position,
    direct_manager_id, notes,
  } = body;

  if (!user_id || !je_badge || !valid_from || !campaign || !position) {
    return NextResponse.json(
      { error: 'user_id, je_badge, valid_from, campaign and position are required' },
      { status: 400 },
    );
  }
  if (!(ROSTER_CAMPAIGNS as readonly string[]).includes(campaign)) {
    return NextResponse.json({ error: 'campaign must be D2D or RETAIL' }, { status: 400 });
  }
  if (!(ROSTER_POSITIONS as readonly string[]).includes(position)) {
    return NextResponse.json({ error: 'position must be agent, jr_manager or sr_manager' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('payroll_roster')
    .insert({
      user_id,
      je_badge: String(je_badge).trim(),
      je_badge_status: 'active',
      valid_from,
      valid_until: valid_until || null,
      campaign,
      position,
      direct_manager_id: direct_manager_id || null,
      notes: notes || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'Este JE badge ya está activo en otro usuario.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const trimmedBadge = String(je_badge).trim();

  // If this badge originally came from a je_badge_alerts row, resolve it.
  await supabase
    .from('je_badge_alerts')
    .update({ resolved_at: new Date().toISOString(), resolved_by: session.user.id })
    .eq('je_badge', trimmedBadge)
    .is('resolved_at', null);

  // Block 05 side-effect: back-fill internal_agent_id on every existing sale
  // that carried this badge in limbo. Idempotent.
  const linkedSales = await reprocessSalesForBadge(trimmedBadge, user_id);

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'roster_entry',
    entity_id: data.id,
    action: 'CREATE',
    actor_id: session.user.id,
    new_value: data,
    change_notes: linkedSales > 0
      ? `JE badge ${trimmedBadge} agregado · ${linkedSales} venta(s) reprocesada(s)`
      : `JE badge ${trimmedBadge} agregado`,
  });

  return NextResponse.json({ ...data, linked_sales: linkedSales }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  // Whitelist only the columns the UI is allowed to touch — never let the
  // caller flip user_id or je_badge, since those identify the row.
  const patch: Record<string, unknown> = {};
  if (updates.je_badge_status !== undefined) patch.je_badge_status = updates.je_badge_status;
  if (updates.valid_from !== undefined) patch.valid_from = updates.valid_from;
  if (updates.valid_until !== undefined) patch.valid_until = updates.valid_until;
  if (updates.campaign !== undefined) patch.campaign = updates.campaign;
  if (updates.position !== undefined) patch.position = updates.position;
  if (updates.direct_manager_id !== undefined) patch.direct_manager_id = updates.direct_manager_id || null;
  if (updates.notes !== undefined) patch.notes = updates.notes || null;

  // Inactivating without a valid_until reads as a still-open contract.
  // Stamp today's date if the caller forgot.
  if (patch.je_badge_status === 'inactive' && !patch.valid_until) {
    patch.valid_until = new Date().toISOString().slice(0, 10);
  }

  const { data: before } = await supabase
    .from('payroll_roster')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  const { data, error } = await supabase
    .from('payroll_roster')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'Este JE badge ya está activo en otro usuario.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const action = patch.je_badge_status === 'inactive'
    && (before as { je_badge_status?: string } | null)?.je_badge_status === 'active'
    ? 'STATE_CHANGE'
    : 'UPDATE';
  await supabase.from('payroll_audit_log').insert({
    entity_type: 'roster_entry',
    entity_id: id,
    action,
    actor_id: session.user.id,
    old_value: before,
    new_value: patch,
    change_notes: action === 'STATE_CHANGE'
      ? `JE badge ${(before as { je_badge?: string } | null)?.je_badge ?? ''} inactivado`
      : null,
  });

  return NextResponse.json(data);
}
