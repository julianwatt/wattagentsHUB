/**
 * Block 08 — Negative balance carry-over + reversal helpers.
 * ============================================================================
 *
 * Owns every write that touches negative_balances or
 * NEGATIVE_BALANCE_COLLECTION line items. The calc orchestrator
 * (calculatePayfile.ts) wires these in; admin UIs hit them through API
 * routes.
 *
 * Conventions:
 *   - Auto-generated balances carry `auto_generated_for_payfile_id`.
 *     calculatePayrollForWeek wipes + recreates these on recalc.
 *   - Manually-created balances (block 04 inactive-user chargebacks,
 *     block 06 inactive-manager chargebacks, future admin entries)
 *     leave the column NULL and are preserved across recalcs.
 *   - "Withdrawing" a NEGATIVE_BALANCE_COLLECTION line item reverts
 *     the linked balance's collected_amount and recomputes its status.
 *     Used by Admin/CEO "Quitar este cobro" action.
 *   - Soft-deleting a balance flips its status to MANUALLY_DELETED and
 *     records the reason in audit log.
 *
 * Server-side only.
 */

import { supabase } from '@/lib/supabase';
import type { NegativeBalance } from '@/types/payroll';
import type {
  NegativeBalanceStatus,
  NegativeBalanceOrigin,
  RosterCampaign,
} from '@/lib/payroll/constants';
import { OPEN_NEGATIVE_BALANCE_STATUSES } from '@/lib/payroll/constants';

// ── Status helpers ──────────────────────────────────────────────────────────

function statusForCollected(
  collected: number,
  original: number,
): NegativeBalanceStatus {
  if (collected >= original) return 'FULLY_COLLECTED';
  if (collected > 0) return 'PARTIALLY_COLLECTED';
  return 'PENDING';
}

// ── wipeAutoNegativeBalanceRowsForPayfile ───────────────────────────────────
//
// Called by the orchestrator before each recalc cycle. Two responsibilities:
//   1. For every auto-generated NEGATIVE_BALANCE_COLLECTION line item on
//      this payfile, revert the linked balance's collected_amount and
//      recompute its status. Then the orchestrator's existing
//      wipeAutoRows() will physically delete the line item.
//   2. Soft-... actually, hard-delete any negative_balances rows whose
//      auto_generated_for_payfile_id matches this payfile. They'll get
//      recreated if the recalc still ends up negative.

export interface WipeResult {
  collectionsReverted: number;
  autoBalancesDeleted: number;
}

export async function wipeAutoNegativeBalanceRowsForPayfile(
  payfileId: string,
): Promise<WipeResult> {
  // 1. Locate auto-generated NEGATIVE_BALANCE_COLLECTION line items.
  const { data: collections } = await supabase
    .from('payfile_line_items')
    .select('id, source_negative_balance_id, amount')
    .eq('payfile_id', payfileId)
    .eq('line_type', 'NEGATIVE_BALANCE_COLLECTION')
    .eq('is_manually_edited', false)
    .eq('is_manually_added', false);

  // 2. Revert collected_amount on each linked balance.
  let collectionsReverted = 0;
  const lineItemIds: string[] = [];
  for (const li of (collections ?? []) as Array<{
    id: string; source_negative_balance_id: string | null; amount: number;
  }>) {
    lineItemIds.push(li.id);
    if (!li.source_negative_balance_id) continue;
    const reverted = Math.abs(Number(li.amount));
    const { data: bal } = await supabase
      .from('negative_balances')
      .select('original_amount, collected_amount')
      .eq('id', li.source_negative_balance_id)
      .maybeSingle();
    if (!bal) continue;
    const newCollected = Math.max(0, Number(bal.collected_amount) - reverted);
    await supabase
      .from('negative_balances')
      .update({
        collected_amount: newCollected,
        remaining_amount: Number(bal.original_amount) - newCollected,
        status: statusForCollected(newCollected, Number(bal.original_amount)),
      })
      .eq('id', li.source_negative_balance_id);
    collectionsReverted += 1;
  }

  // 3. Delete the line items now that the balances are squared.
  if (lineItemIds.length > 0) {
    await supabase
      .from('payfile_line_items')
      .delete()
      .in('id', lineItemIds);
  }

  // 4. Delete auto-generated balances tied to this payfile (residual
  //    rolled by the previous calc's finalize step).
  const { data: deleted } = await supabase
    .from('negative_balances')
    .delete()
    .eq('auto_generated_for_payfile_id', payfileId)
    .select('id');

  return {
    collectionsReverted,
    autoBalancesDeleted: (deleted ?? []).length,
  };
}

// ── applyPendingBalancesToPayfile ───────────────────────────────────────────
//
// Walks the user's pending balances oldest-first and creates
// NEGATIVE_BALANCE_COLLECTION line items up to the available positive
// total. Returns the running total after collections.

export interface ApplyPendingResult {
  totalAfterCollection: number;
  linesCreated: number;
  fullyCollected: number;
  partiallyCollected: number;
}

export async function applyPendingBalancesToPayfile(
  userId: string,
  payfileId: string,
  startingTotal: number,
): Promise<ApplyPendingResult> {
  if (startingTotal <= 0) {
    return { totalAfterCollection: startingTotal, linesCreated: 0, fullyCollected: 0, partiallyCollected: 0 };
  }

  const { data: balances } = await supabase
    .from('negative_balances')
    .select('id, original_amount, collected_amount, remaining_amount, origin_week, description, campaign')
    .eq('user_id', userId)
    .in('status', OPEN_NEGATIVE_BALANCE_STATUSES as readonly NegativeBalanceStatus[])
    .order('origin_week', { ascending: true });

  let running = startingTotal;
  let linesCreated = 0;
  let fullyCollected = 0;
  let partiallyCollected = 0;

  for (const bal of (balances ?? []) as Array<{
    id: string;
    original_amount: number;
    collected_amount: number;
    remaining_amount: number;
    origin_week: string;
    description: string;
    campaign: RosterCampaign | null;
  }>) {
    if (running <= 0) break;
    const remaining = Number(bal.remaining_amount);
    if (remaining <= 0) continue;

    const toCollect = Math.min(remaining, running);
    const isFull = toCollect >= remaining;

    // Line item: negative amount (it's a deduction).
    const liDescription = `Saldo negativo PF ${bal.origin_week}${bal.campaign ? ' ' + bal.campaign : ''} ${isFull ? 'completo' : 'parcial'}`;
    const { error: liErr } = await supabase.from('payfile_line_items').insert({
      payfile_id: payfileId,
      line_type: 'NEGATIVE_BALANCE_COLLECTION',
      description: liDescription,
      source_negative_balance_id: bal.id,
      amount: -toCollect,
      original_amount: -toCollect,
    });
    if (liErr) {
      console.error('[applyPendingBalancesToPayfile] line insert failed:', liErr);
      continue;
    }

    // Update the balance.
    const newCollected = Number(bal.collected_amount) + toCollect;
    const newRemaining = Number(bal.original_amount) - newCollected;
    const newStatus = statusForCollected(newCollected, Number(bal.original_amount));
    await supabase
      .from('negative_balances')
      .update({
        collected_amount: newCollected,
        remaining_amount: newRemaining,
        status: newStatus,
      })
      .eq('id', bal.id);

    running -= toCollect;
    linesCreated += 1;
    if (isFull) fullyCollected += 1; else partiallyCollected += 1;
  }

  return { totalAfterCollection: running, linesCreated, fullyCollected, partiallyCollected };
}

// ── finalizePayfileIfNegative ───────────────────────────────────────────────
//
// If the running total is still < 0 after applying carry-over, rolls the
// absolute residual into a new auto-generated negative_balances row and
// forces payfiles.total_amount to 0. Otherwise just writes the running
// total to the payfile.

export interface FinalizeResult {
  finalTotal: number;
  hadNegativeBalance: boolean;
  newBalanceId: string | null;
}

export async function finalizePayfileIfNegative(
  payfileId: string,
  userId: string,
  payWeek: string,
  runningTotal: number,
): Promise<FinalizeResult> {
  if (runningTotal >= 0) {
    await supabase
      .from('payfiles')
      .update({ total_amount: runningTotal, had_negative_balance: false })
      .eq('id', payfileId);
    return { finalTotal: runningTotal, hadNegativeBalance: false, newBalanceId: null };
  }

  // Negative case — roll into a new balance, force total to 0.
  const absResidual = Math.abs(runningTotal);

  // Capture the user's snapshot context for traceability.
  const { data: user } = await supabase
    .from('users')
    .select('payroll_status, manager_id')
    .eq('id', userId)
    .maybeSingle();
  const userStatus = (user?.payroll_status === 'inactive' ? 'inactive' : 'active') as 'active' | 'inactive';

  // Origin — pick COMMISSION if the negative came mostly from commission
  // lines, OVERRIDE otherwise. Simple heuristic; admin can re-tag later
  // if needed.
  const { data: lines } = await supabase
    .from('payfile_line_items')
    .select('line_type, amount')
    .eq('payfile_id', payfileId);
  let commissionSum = 0;
  let overrideSum = 0;
  for (const l of (lines ?? []) as Array<{ line_type: string; amount: number }>) {
    const v = Number(l.amount);
    if (l.line_type === 'COMMISSION') commissionSum += v;
    else if (l.line_type === 'OVERRIDE') overrideSum += v;
  }
  const origin: NegativeBalanceOrigin =
    commissionSum <= overrideSum ? 'COMMISSION' : 'OVERRIDE';

  const description = `Saldo negativo PF ${payWeek}`;

  const { data: newBal, error: nbErr } = await supabase
    .from('negative_balances')
    .insert({
      user_id: userId,
      origin,
      source_sale_id: null,
      original_amount: absResidual,
      collected_amount: 0,
      remaining_amount: absResidual,
      origin_week: payWeek,
      description,
      campaign: null,
      manager_at_time: user?.manager_id ?? null,
      user_status_when_created: userStatus,
      status: 'PENDING',
      auto_generated_for_payfile_id: payfileId,
    })
    .select('id')
    .single();

  if (nbErr || !newBal) {
    console.error('[finalizePayfileIfNegative] insert failed:', nbErr);
    // Don't force 0 if we couldn't roll the residual — leave the negative
    // total visible so the issue surfaces in QA.
    await supabase.from('payfiles').update({ total_amount: runningTotal }).eq('id', payfileId);
    return { finalTotal: runningTotal, hadNegativeBalance: false, newBalanceId: null };
  }

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'negative_balance',
    entity_id: newBal.id,
    action: 'CREATE',
    actor_id: null,
    new_value: {
      user_id: userId, origin, original_amount: absResidual,
      origin_week: payWeek, auto_generated_for_payfile_id: payfileId,
      user_status_when_created: userStatus,
    },
    change_notes: `Sistema creó saldo negativo de $${absResidual.toFixed(2)} al finalizar payfile.`,
  });

  await supabase
    .from('payfiles')
    .update({ total_amount: 0, had_negative_balance: true })
    .eq('id', payfileId);

  return { finalTotal: 0, hadNegativeBalance: true, newBalanceId: (newBal as { id: string }).id };
}

// ── withdrawCollection ──────────────────────────────────────────────────────
//
// Admin/CEO action: "Quitar este cobro". Reverts the collected_amount on
// the linked balance and deletes the line item. Recomputes payfile total.

export interface WithdrawCollectionResult {
  ok: boolean;
  reverted_amount: number;
  balance_id: string;
  new_balance_status: NegativeBalanceStatus;
  new_payfile_total: number;
  error?: string;
}

export async function withdrawCollection(
  lineItemId: string,
  actorId: string,
): Promise<WithdrawCollectionResult> {
  const { data: li } = await supabase
    .from('payfile_line_items')
    .select('id, payfile_id, line_type, amount, source_negative_balance_id')
    .eq('id', lineItemId)
    .maybeSingle();
  if (!li) return badWithdraw('Line item no encontrado.');
  if ((li as { line_type: string }).line_type !== 'NEGATIVE_BALANCE_COLLECTION') {
    return badWithdraw('Sólo líneas NEGATIVE_BALANCE_COLLECTION pueden retirarse.');
  }
  const balanceId = (li as { source_negative_balance_id: string | null }).source_negative_balance_id;
  if (!balanceId) return badWithdraw('Line item sin balance origen — no se puede revertir.');

  const reverted = Math.abs(Number((li as { amount: number }).amount));

  const { data: bal } = await supabase
    .from('negative_balances')
    .select('original_amount, collected_amount')
    .eq('id', balanceId)
    .maybeSingle();
  if (!bal) return badWithdraw('Balance origen no encontrado.');

  const newCollected = Math.max(0, Number(bal.collected_amount) - reverted);
  const newStatus = statusForCollected(newCollected, Number(bal.original_amount));
  await supabase
    .from('negative_balances')
    .update({
      collected_amount: newCollected,
      remaining_amount: Number(bal.original_amount) - newCollected,
      status: newStatus,
    })
    .eq('id', balanceId);

  // Delete the line item.
  await supabase.from('payfile_line_items').delete().eq('id', lineItemId);

  // Recompute payfile total.
  const payfileId = (li as { payfile_id: string }).payfile_id;
  const { data: lines } = await supabase
    .from('payfile_line_items')
    .select('amount')
    .eq('payfile_id', payfileId);
  const total = (lines ?? []).reduce((acc, r) => acc + Number(r.amount), 0);
  await supabase.from('payfiles').update({ total_amount: total }).eq('id', payfileId);

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'payfile_line_item',
    entity_id: lineItemId,
    action: 'DELETE',
    actor_id: actorId,
    change_notes: `Cobro de saldo negativo retirado por orden de gestión. $${reverted.toFixed(2)} regresa a pendientes.`,
  });

  return {
    ok: true,
    reverted_amount: reverted,
    balance_id: balanceId,
    new_balance_status: newStatus,
    new_payfile_total: total,
  };
}

function badWithdraw(msg: string): WithdrawCollectionResult {
  return { ok: false, reverted_amount: 0, balance_id: '', new_balance_status: 'PENDING', new_payfile_total: 0, error: msg };
}

// ── deleteNegativeBalance (soft) ────────────────────────────────────────────
//
// Admin-only soft delete with mandatory reason. The balance stays in the
// table with status=MANUALLY_DELETED so the audit trail is intact, but it
// no longer participates in carry-over.

export async function deleteNegativeBalance(
  id: string,
  reason: string,
  actorId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!reason || reason.trim().length < 3) {
    return { ok: false, error: 'La razón es obligatoria (mínimo 3 caracteres).' };
  }

  const { data: before } = await supabase
    .from('negative_balances')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!before) return { ok: false, error: 'Saldo no encontrado.' };
  if ((before as NegativeBalance).status === 'MANUALLY_DELETED') {
    return { ok: false, error: 'Ya estaba eliminado.' };
  }

  const { error } = await supabase
    .from('negative_balances')
    .update({ status: 'MANUALLY_DELETED' })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'negative_balance',
    entity_id: id,
    action: 'DELETE',
    actor_id: actorId,
    old_value: before,
    change_notes: `Eliminación manual: ${reason.trim()}`,
  });
  return { ok: true };
}
