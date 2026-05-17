import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';

/**
 * Agent merge endpoint — block 02 §Lógica de fusión de agentes.
 *
 *   POST /api/payroll/roster/merge?dryRun=1
 *     → returns a preview of what would change. Nothing is written.
 *
 *   POST /api/payroll/roster/merge
 *     → executes the merge. The caller must include `confirm: "FUSIONAR"`
 *       in the body, matching the explicit-text confirmation the spec
 *       requires.
 *
 * Effects of a real merge (per master plan):
 *   1. Every payroll_roster row of the source user moves to the destination.
 *   2. Future payroll_sales pointing to source.id get their internal_agent_id
 *      pointed at the destination. We DO NOT touch sales that already have a
 *      pay_week set — those belong to a published payfile and must stay
 *      pinned to the historical identity.
 *   3. Source user is marked inactive (auth + payroll), with a note.
 *   4. A STATE_CHANGE row lands in payroll_audit_log with full old/new.
 *
 * Things we deliberately DO NOT touch:
 *   - payfiles, payfile_line_items, payfile_versions, negative_balances of
 *     the source user — historical payroll stays under the source identity.
 */

interface MergeBody {
  source_id?: string;
  destination_id?: string;
  confirm?: string;
}

export async function POST(req: NextRequest) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dryRun') === '1';

  const { source_id, destination_id, confirm }: MergeBody = await req.json();
  if (!source_id || !destination_id) {
    return NextResponse.json({ error: 'source_id and destination_id are required' }, { status: 400 });
  }
  if (source_id === destination_id) {
    return NextResponse.json({ error: 'No se puede fusionar a un usuario consigo mismo' }, { status: 400 });
  }

  // Pull both users — confirm they exist and we're not trying to merge
  // privileged accounts away.
  const [src, dst] = await Promise.all([
    supabase.from('users').select('id, name, username, role, is_active, payroll_status').eq('id', source_id).single(),
    supabase.from('users').select('id, name, username, role, is_active, payroll_status').eq('id', destination_id).single(),
  ]);
  if (src.error || !src.data) return NextResponse.json({ error: 'Usuario fuente no encontrado' }, { status: 404 });
  if (dst.error || !dst.data) return NextResponse.json({ error: 'Usuario destino no encontrado' }, { status: 404 });
  if (src.data.role === 'admin' || src.data.role === 'ceo') {
    return NextResponse.json({ error: 'No se puede fusionar un usuario admin o CEO' }, { status: 403 });
  }
  if (dst.data.role === 'admin' || dst.data.role === 'ceo') {
    return NextResponse.json({ error: 'No se puede fusionar hacia un usuario admin o CEO' }, { status: 403 });
  }

  // Gather what would change. The preview returns the same shape, the
  // mutating path uses it for the audit log.
  const [
    badgesRes,
    pastPayfilesRes,
    negativesRes,
    futureSalesRes,
  ] = await Promise.all([
    supabase.from('payroll_roster').select('id, je_badge, je_badge_status, campaign, position').eq('user_id', source_id),
    supabase.from('payfiles').select('id, pay_week, state, total_amount').eq('user_id', source_id),
    supabase.from('negative_balances').select('id, status, remaining_amount, origin_week').eq('user_id', source_id),
    // "Future" = sales not yet attached to a pay_week. Those whose pay_week
    // is already set belong to a published payfile and stay under the source.
    supabase.from('payroll_sales').select('id, contract_id, pay_week').eq('internal_agent_id', source_id).is('pay_week', null),
  ]);

  const preview = {
    source: src.data,
    destination: dst.data,
    badges_to_move: badgesRes.data ?? [],
    past_payfiles_preserved: pastPayfilesRes.data ?? [],
    negative_balances_preserved: negativesRes.data ?? [],
    future_sales_repointed: futureSalesRes.data ?? [],
  };

  if (dryRun) return NextResponse.json(preview);

  // Real execution path — require explicit confirmation text.
  if (confirm !== 'FUSIONAR') {
    return NextResponse.json(
      { error: 'Confirmación requerida: enviar `confirm: "FUSIONAR"` en el cuerpo.' },
      { status: 400 },
    );
  }

  // Perform the moves. We don't have transaction support via supabase-js;
  // each step is idempotent and the audit log captures the intent so a
  // partial failure leaves a recoverable trail.
  if (preview.badges_to_move.length > 0) {
    const { error } = await supabase
      .from('payroll_roster')
      .update({ user_id: destination_id })
      .eq('user_id', source_id);
    if (error) return NextResponse.json({ error: `Badge transfer failed: ${error.message}` }, { status: 500 });
  }

  if (preview.future_sales_repointed.length > 0) {
    const { error } = await supabase
      .from('payroll_sales')
      .update({ internal_agent_id: destination_id })
      .eq('internal_agent_id', source_id)
      .is('pay_week', null);
    if (error) return NextResponse.json({ error: `Sales repoint failed: ${error.message}` }, { status: 500 });
  }

  // Mark source inactive (auth + payroll) with a merge note.
  const mergeNoteSuffix = ` · Fusionado en ${dst.data.name} (${dst.data.username}) el ${new Date().toISOString().slice(0, 10)}`;
  const { error: userErr } = await supabase
    .from('users')
    .update({
      is_active: false,
      payroll_status: 'inactive',
      name: `${src.data.name}${mergeNoteSuffix}`,
    })
    .eq('id', source_id);
  if (userErr) return NextResponse.json({ error: `Source deactivate failed: ${userErr.message}` }, { status: 500 });

  // Audit log entry — captures the full preview snapshot.
  await supabase.from('payroll_audit_log').insert({
    entity_type: 'roster_merge',
    entity_id: source_id,
    action: 'STATE_CHANGE',
    actor_id: session.user.id,
    old_value: { source: src.data, destination: dst.data },
    new_value: preview,
    change_notes: `Roster merge ${src.data.username} → ${dst.data.username}`,
  });

  return NextResponse.json({ success: true, preview });
}
