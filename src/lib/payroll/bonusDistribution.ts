/**
 * Block 10 — Company-bonus distribution helpers.
 * ============================================================================
 *
 * Admin/CEO distribute a company_bonuses row across one or more recipients.
 * For each split:
 *   - Insert a bonus_distributions row.
 *   - Upsert the recipient's payfile for the chosen pay_week.
 *   - Insert a COMPANY_BONUS line item linked back via
 *     payfile_line_items.source_bonus_distribution_id.
 *   - Recompute the recipient's payfile total.
 *   - Set company_bonuses.paid_to_agents = TRUE when any split lands.
 *
 * The link via source_bonus_distribution_id lets editDistribution /
 * deleteDistribution mutate both sides in sync, and the orchestrator's
 * wipeAutoRows excludes COMPANY_BONUS lines that carry that link (those
 * are admin-driven, not sales-driven).
 *
 * Server-side only.
 */

import { supabase } from '@/lib/supabase';
import type { CompanyBonus, BonusDistribution, Payfile } from '@/types/payroll';
import { EDITABLE_PAYFILE_STATES, type PayfileState } from '@/lib/payroll/constants';

// ── distributeBono ──────────────────────────────────────────────────────────

export interface DistributionInput {
  recipient_id: string;
  amount: number;
  pay_week: string;     // YYYY-MM-DD
  notes?: string | null;
}

export interface DistributeBonoArgs {
  bonus_id: string;
  splits: DistributionInput[];
  actor_id: string;
}

export interface DistributeBonoResult {
  ok: boolean;
  error?: string;
  distributions_created: number;
  line_items_created: number;
  payfiles_touched: number;
  paid_to_agents: boolean;
}

export async function distributeBono(args: DistributeBonoArgs): Promise<DistributeBonoResult> {
  if (!args.bonus_id) return bad('bonus_id requerido');
  if (!Array.isArray(args.splits) || args.splits.length === 0) return bad('Al menos una distribución requerida');

  const { data: bonus } = await supabase
    .from('company_bonuses')
    .select('*')
    .eq('id', args.bonus_id)
    .maybeSingle();
  if (!bonus) return bad('Bono no encontrado.');
  const b = bonus as CompanyBonus;

  // Validations.
  const sum = args.splits.reduce((acc, s) => acc + Number(s.amount), 0);
  if (sum > Number(b.total_amount) + 0.005) {
    return bad(`La suma de distribuciones ($${sum.toFixed(2)}) excede el total del bono ($${Number(b.total_amount).toFixed(2)}).`);
  }
  for (const s of args.splits) {
    if (!s.recipient_id) return bad('Cada distribución necesita un receptor.');
    if (!(Number(s.amount) > 0)) return bad('Cada distribución necesita un monto > 0.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.pay_week)) return bad(`pay_week inválido: ${s.pay_week}`);
  }

  let lineItemsCreated = 0;
  let distributionsCreated = 0;
  const payfilesTouched = new Set<string>();

  for (const split of args.splits) {
    // 1. Insert bonus_distribution.
    const { data: distRow, error: dErr } = await supabase
      .from('bonus_distributions')
      .insert({
        company_bonus_id: args.bonus_id,
        recipient_id: split.recipient_id,
        amount: split.amount,
        pay_week: split.pay_week,
        notes: split.notes ?? null,
        created_by: args.actor_id,
      })
      .select('id')
      .single();
    if (dErr || !distRow) {
      console.error('[distributeBono] dist insert failed:', dErr);
      continue;
    }
    distributionsCreated += 1;

    // 2. Upsert recipient's payfile for that pay_week.
    const payfileId = await upsertPayfile(split.recipient_id, split.pay_week);

    // 3. Insert COMPANY_BONUS line item linked to the distribution.
    const { error: liErr } = await supabase
      .from('payfile_line_items')
      .insert({
        payfile_id: payfileId,
        line_type: 'COMPANY_BONUS',
        description: `Bono empresa: ${b.description}`,
        source_bonus_distribution_id: (distRow as { id: string }).id,
        amount: split.amount,
        original_amount: split.amount,
      });
    if (liErr) {
      console.error('[distributeBono] line item insert failed:', liErr);
      continue;
    }
    lineItemsCreated += 1;
    payfilesTouched.add(payfileId);
  }

  // 4. Recompute totals for every touched payfile.
  for (const pfId of payfilesTouched) {
    await recomputePayfileTotal(pfId);
  }

  // 5. Mark the bonus as paid_to_agents.
  const paidToAgents = distributionsCreated > 0;
  if (paidToAgents && !b.paid_to_agents) {
    await supabase
      .from('company_bonuses')
      .update({ paid_to_agents: true })
      .eq('id', args.bonus_id);
  }

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'company_bonus',
    entity_id: args.bonus_id,
    action: 'UPDATE',
    actor_id: args.actor_id,
    new_value: { distributions: args.splits, distributions_created: distributionsCreated },
    change_notes: `Distribuido a ${distributionsCreated} receptor(es).`,
  });

  return {
    ok: true,
    distributions_created: distributionsCreated,
    line_items_created: lineItemsCreated,
    payfiles_touched: payfilesTouched.size,
    paid_to_agents: paidToAgents,
  };
}

// ── editDistribution ────────────────────────────────────────────────────────

export interface EditDistributionArgs {
  id: string;
  actor_id: string;
  amount?: number;
  pay_week?: string;
  notes?: string | null;
}

export async function editDistribution(args: EditDistributionArgs): Promise<{ ok: boolean; error?: string }> {
  const { data: before } = await supabase
    .from('bonus_distributions')
    .select('*')
    .eq('id', args.id)
    .maybeSingle();
  if (!before) return { ok: false, error: 'Distribución no encontrada.' };

  // State guard: refuse if any linked line item sits in a non-editable payfile.
  const linked = await getLineItemForDistribution(args.id);
  if (linked) {
    if (!isEditableState(linked.state)) {
      return { ok: false, error: `Payfile receptor en estado ${linked.state}, no editable.` };
    }
  }

  const distPatch: Record<string, unknown> = {};
  if (typeof args.amount === 'number') {
    if (!(args.amount > 0)) return { ok: false, error: 'amount debe ser > 0.' };
    distPatch.amount = args.amount;
  }
  if (typeof args.pay_week === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.pay_week)) return { ok: false, error: 'pay_week inválido.' };
    distPatch.pay_week = args.pay_week;
  }
  if (args.notes !== undefined) distPatch.notes = args.notes;
  if (Object.keys(distPatch).length === 0) return { ok: false, error: 'Sin cambios.' };

  // If pay_week changed, the line item needs to move to a different payfile.
  const beforeRow = before as BonusDistribution;
  const targetWeekChanged = typeof args.pay_week === 'string' && args.pay_week !== beforeRow.pay_week;
  let newPayfileId: string | null = null;
  if (targetWeekChanged) {
    newPayfileId = await upsertPayfile(beforeRow.recipient_id, args.pay_week!);
  }

  const { error: dErr } = await supabase.from('bonus_distributions').update(distPatch).eq('id', args.id);
  if (dErr) return { ok: false, error: dErr.message };

  // Sync the linked line item.
  if (linked) {
    const liPatch: Record<string, unknown> = {};
    if (typeof args.amount === 'number') {
      liPatch.amount = args.amount;
      liPatch.original_amount = args.amount;
    }
    if (newPayfileId) liPatch.payfile_id = newPayfileId;
    if (Object.keys(liPatch).length > 0) {
      await supabase.from('payfile_line_items').update(liPatch).eq('id', linked.line_item_id);
    }
    if (newPayfileId && newPayfileId !== linked.payfile_id) {
      await recomputePayfileTotal(linked.payfile_id);
      await recomputePayfileTotal(newPayfileId);
    } else {
      await recomputePayfileTotal(linked.payfile_id);
    }
  }

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'bonus_distribution',
    entity_id: args.id,
    action: 'UPDATE',
    actor_id: args.actor_id,
    old_value: beforeRow,
    new_value: distPatch,
  });

  return { ok: true };
}

// ── deleteDistribution ──────────────────────────────────────────────────────

export async function deleteDistribution(
  id: string,
  actorId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: before } = await supabase
    .from('bonus_distributions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!before) return { ok: false, error: 'Distribución no encontrada.' };

  const linked = await getLineItemForDistribution(id);
  if (linked && !isEditableState(linked.state)) {
    return { ok: false, error: `Payfile receptor en estado ${linked.state}, no editable.` };
  }

  // Delete the line item first (no FK CASCADE — we manage it explicitly).
  if (linked) {
    await supabase.from('payfile_line_items').delete().eq('id', linked.line_item_id);
    await recomputePayfileTotal(linked.payfile_id);
  }

  await supabase.from('bonus_distributions').delete().eq('id', id);

  // Re-check paid_to_agents on the parent bonus — if no distributions remain,
  // flip back to false.
  const beforeRow = before as BonusDistribution;
  const { count } = await supabase
    .from('bonus_distributions')
    .select('id', { count: 'exact', head: true })
    .eq('company_bonus_id', beforeRow.company_bonus_id);
  if ((count ?? 0) === 0) {
    await supabase
      .from('company_bonuses')
      .update({ paid_to_agents: false })
      .eq('id', beforeRow.company_bonus_id);
  }

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'bonus_distribution',
    entity_id: id,
    action: 'DELETE',
    actor_id: actorId,
    old_value: beforeRow,
    change_notes: 'Distribución eliminada manualmente.',
  });

  return { ok: true };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function bad(error: string): DistributeBonoResult {
  return { ok: false, error, distributions_created: 0, line_items_created: 0, payfiles_touched: 0, paid_to_agents: false };
}

function isEditableState(state: PayfileState | undefined): boolean {
  if (!state) return true;
  return (EDITABLE_PAYFILE_STATES as readonly PayfileState[]).includes(state);
}

async function upsertPayfile(userId: string, payWeek: string): Promise<string> {
  const { data: existing } = await supabase
    .from('payfiles')
    .select('id')
    .eq('user_id', userId)
    .eq('pay_week', payWeek)
    .maybeSingle();
  if (existing) return (existing as { id: string }).id;
  const { data: created, error } = await supabase
    .from('payfiles')
    .insert({ user_id: userId, pay_week: payWeek, state: 'DRAFT', total_amount: 0 })
    .select('id')
    .single();
  if (error || !created) throw new Error(`upsertPayfile: ${error?.message ?? 'failed'}`);
  return (created as { id: string }).id;
}

async function recomputePayfileTotal(payfileId: string): Promise<void> {
  const { data } = await supabase
    .from('payfile_line_items')
    .select('amount')
    .eq('payfile_id', payfileId);
  const total = (data ?? []).reduce((acc, r) => acc + Number(r.amount), 0);
  await supabase.from('payfiles').update({ total_amount: total }).eq('id', payfileId);
}

interface LinkedLineItem {
  line_item_id: string;
  payfile_id: string;
  state: PayfileState;
}
async function getLineItemForDistribution(distId: string): Promise<LinkedLineItem | null> {
  const { data } = await supabase
    .from('payfile_line_items')
    .select('id, payfile_id, payfiles!inner(state)')
    .eq('source_bonus_distribution_id', distId)
    .maybeSingle();
  if (!data) return null;
  const row = data as { id: string; payfile_id: string; payfiles: unknown };
  const pf = row.payfiles;
  const state = Array.isArray(pf)
    ? (pf[0] as { state?: PayfileState } | undefined)?.state
    : (pf as { state?: PayfileState } | undefined)?.state;
  if (!state) return null;
  return { line_item_id: row.id, payfile_id: row.payfile_id, state };
}

// Re-export Payfile for symmetry with other helper modules.
export type { Payfile };
