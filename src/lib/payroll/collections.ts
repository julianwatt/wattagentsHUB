/**
 * Block 09 — Collections: schedule, apply, credit, cancel.
 * ============================================================================
 *
 * Owns every write touching collections / collection_installments and the
 * resulting COLLECTION (debtor side) / COLLECTION_INCOME (beneficiary side)
 * line items.
 *
 * Order of application in calculatePayrollForWeek:
 *   1. Commissions + overrides  (block 06)
 *   2. Negative balance carry-over  (block 08)
 *   3. Collection installments  (THIS module)
 *   4. Beneficiary credit pass  (THIS module)
 *   5. Finalize-if-negative  (block 08)
 *
 * Idempotency: on recalc the orchestrator calls wipeAutoCollectionRows
 * for each debtor's payfile, which reverts the linked installment's
 * collected_amount + status and clears applied_payfile_id. Then the
 * apply step re-runs from a clean slate.
 *
 * Server-side only.
 */

import { supabase } from '@/lib/supabase';
import type {
  CollectionStatus,
  CollectionInstallmentStatus,
  PayfileLineType,
} from '@/lib/payroll/constants';

// Roles allowed as beneficiary (Admin excluded per master plan §Collections).
const ALLOWED_BENEFICIARY_ROLES = new Set(['agent', 'jr_manager', 'sr_manager', 'ceo']);

// ── Status math ─────────────────────────────────────────────────────────────

function installmentStatusForCollected(
  collected: number,
  amount: number,
): CollectionInstallmentStatus {
  if (collected >= amount) return 'FULLY_COLLECTED';
  if (collected > 0) return 'PARTIALLY_COLLECTED';
  return 'PENDING';
}

// ── createCollection ────────────────────────────────────────────────────────

export interface CreateCollectionArgs {
  description: string;
  debtor_id: string;
  beneficiary_id: string;
  total_amount: number;
  installments: number;
  start_week: string; // YYYY-MM-DD
  created_by: string;
}

export interface CreateCollectionResult {
  ok: boolean;
  collection_id?: string;
  error?: string;
}

export async function createCollection(args: CreateCollectionArgs): Promise<CreateCollectionResult> {
  // ── Validation (mirrors UI; defense in depth) ──────────────────────────────
  if (!args.description?.trim()) return bad('description requerida');
  if (args.total_amount <= 0) return bad('total_amount debe ser > 0');
  if (!Number.isInteger(args.installments) || args.installments < 1) return bad('installments inválido');
  if (args.debtor_id === args.beneficiary_id) return bad('Deudor y beneficiario no pueden ser la misma persona.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.start_week)) return bad('start_week inválido (YYYY-MM-DD)');

  // Validate beneficiary role.
  const { data: beneficiary } = await supabase
    .from('users')
    .select('id, role')
    .eq('id', args.beneficiary_id)
    .maybeSingle();
  if (!beneficiary) return bad('Beneficiario no encontrado.');
  if (!ALLOWED_BENEFICIARY_ROLES.has((beneficiary as { role: string }).role)) {
    return bad('El beneficiario no puede ser admin. Roles permitidos: agente, manager, CEO.');
  }

  // Validate debtor exists.
  const { data: debtor } = await supabase
    .from('users')
    .select('id')
    .eq('id', args.debtor_id)
    .maybeSingle();
  if (!debtor) return bad('Deudor no encontrado.');

  // ── Insert collection. ─────────────────────────────────────────────────────
  const { data: collection, error: cErr } = await supabase
    .from('collections')
    .insert({
      description: args.description.trim(),
      debtor_id: args.debtor_id,
      beneficiary_id: args.beneficiary_id,
      total_amount: args.total_amount,
      installments: args.installments,
      start_week: args.start_week,
      created_by: args.created_by,
      status: 'ACTIVE' as CollectionStatus,
    })
    .select('id')
    .single();
  if (cErr || !collection) return bad(cErr?.message ?? 'Insert collection falló.');

  // ── Generate installments. Distribute remainder cents to the last row. ────
  const installments = computeInstallments(args.total_amount, args.installments, args.start_week);
  const rows = installments.map((inst, idx) => ({
    collection_id: collection.id,
    installment_number: idx + 1,
    scheduled_week: inst.scheduled_week,
    amount: inst.amount,
    collected_amount: 0,
    status: 'PENDING' as CollectionInstallmentStatus,
  }));
  const { error: iErr } = await supabase
    .from('collection_installments')
    .insert(rows);
  if (iErr) {
    // Roll back the collection row to avoid orphans.
    await supabase.from('collections').delete().eq('id', collection.id);
    return bad(`Insert installments falló: ${iErr.message}`);
  }

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'collection',
    entity_id: collection.id,
    action: 'CREATE',
    actor_id: args.created_by,
    new_value: { ...args, installments_generated: rows.length },
  });

  return { ok: true, collection_id: collection.id };
}

function bad(error: string): CreateCollectionResult { return { ok: false, error }; }

// ── Installment generation ──────────────────────────────────────────────────

interface ComputedInstallment {
  scheduled_week: string;
  amount: number;
}

export function computeInstallments(
  total: number,
  n: number,
  startWeek: string,
): ComputedInstallment[] {
  // Work in cents to avoid float drift; last installment absorbs remainder.
  const totalCents = Math.round(total * 100);
  const baseCents = Math.floor(totalCents / n);
  const remainderCents = totalCents - baseCents * n;
  const out: ComputedInstallment[] = [];
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1;
    const cents = baseCents + (isLast ? remainderCents : 0);
    out.push({
      scheduled_week: addWeeks(startWeek, i),
      amount: cents / 100,
    });
  }
  return out;
}

function addWeeks(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

// ── wipeAutoCollectionRowsForPayfile ────────────────────────────────────────
//
// Pre-recalc cleanup for a debtor's payfile. Symmetric to
// wipeAutoNegativeBalanceRowsForPayfile (block 08): finds auto COLLECTION
// line items, reverses each linked installment, deletes the lines.
// Beneficiary-side COLLECTION_INCOME lines are wiped by the orchestrator's
// generic wipeAutoRows on the beneficiary's own payfile.

export interface WipeCollectionResult {
  installmentsReverted: number;
}

export async function wipeAutoCollectionRowsForPayfile(
  payfileId: string,
): Promise<WipeCollectionResult> {
  const { data: lines } = await supabase
    .from('payfile_line_items')
    .select('id, amount, source_collection_id')
    .eq('payfile_id', payfileId)
    .eq('line_type', 'COLLECTION' as PayfileLineType)
    .eq('is_manually_edited', false)
    .eq('is_manually_added', false);

  // Find installment rows for this payfile via applied_payfile_id.
  const { data: installments } = await supabase
    .from('collection_installments')
    .select('id, amount, collected_amount')
    .eq('applied_payfile_id', payfileId);

  let reverted = 0;
  for (const inst of (installments ?? []) as Array<{ id: string; amount: number; collected_amount: number }>) {
    // Conservative revert: zero out the applied_payfile_id + recompute
    // status from collected_amount. Since this payfile's line that drove
    // the collection is about to be deleted, the contribution from THIS
    // payfile must come off the installment's collected total.
    // We can't trivially separate "how much THIS payfile contributed"
    // from history, so we rely on the line item's amount.
    const contribution = (lines ?? []).find(
      (l) => l.source_collection_id != null && true && false, // placeholder; see next line
    );
    void contribution; // kept for clarity; the actual contribution lookup is below
    // The line and the installment connect through the payfile, not by
    // source_collection_id alone (a payfile could hold multiple
    // installments of the same collection across weeks — though that's
    // unusual). We sum the absolute amounts of the lines for this payfile
    // whose source_collection_id matches this installment's collection.
    const { data: collMeta } = await supabase
      .from('collection_installments')
      .select('collection_id')
      .eq('id', inst.id)
      .maybeSingle();
    const collId = (collMeta as { collection_id: string } | null)?.collection_id;
    if (!collId) continue;

    const matched = (lines ?? []).filter(
      (l) => (l as { source_collection_id: string | null }).source_collection_id === collId,
    );
    const contributedAmount = matched.reduce(
      (acc, l) => acc + Math.abs(Number((l as { amount: number }).amount)),
      0,
    );

    const newCollected = Math.max(0, Number(inst.collected_amount) - contributedAmount);
    await supabase
      .from('collection_installments')
      .update({
        collected_amount: newCollected,
        status: installmentStatusForCollected(newCollected, Number(inst.amount)),
        applied_payfile_id: null,
      })
      .eq('id', inst.id);
    reverted += 1;
  }

  // Delete the auto line items.
  const ids = (lines ?? []).map((l) => l.id);
  if (ids.length > 0) {
    await supabase.from('payfile_line_items').delete().in('id', ids);
  }

  // If a collection that was previously COMPLETED rolled back during the
  // revert (because we just decreased collected on one of its installments),
  // we should also re-open it. Cheaper: re-evaluate from scratch.
  // Pull affected collections and recompute their status.
  const affectedCollectionIds = Array.from(new Set(
    (lines ?? [])
      .map((l) => (l as { source_collection_id: string | null }).source_collection_id)
      .filter((id): id is string => !!id),
  ));
  for (const cid of affectedCollectionIds) {
    await refreshCollectionStatus(cid);
  }

  return { installmentsReverted: reverted };
}

async function refreshCollectionStatus(collectionId: string): Promise<void> {
  const { data: rows } = await supabase
    .from('collection_installments')
    .select('status')
    .eq('collection_id', collectionId);
  const statuses = (rows ?? []).map((r) => r.status as CollectionInstallmentStatus);
  if (statuses.length === 0) return;
  const allDone = statuses.every((s) => s === 'FULLY_COLLECTED' || s === 'CANCELLED');
  const newStatus: CollectionStatus = allDone ? 'COMPLETED' : 'ACTIVE';
  // Don't touch CANCELLED collections.
  const { data: coll } = await supabase
    .from('collections')
    .select('status')
    .eq('id', collectionId)
    .maybeSingle();
  if ((coll as { status: CollectionStatus } | null)?.status === 'CANCELLED') return;
  await supabase.from('collections').update({ status: newStatus }).eq('id', collectionId);
}

// ── applyCollectionInstallmentsToDebtor ─────────────────────────────────────
//
// Returns the new running total after collection deductions + the list of
// (beneficiary_id, amount, description, ...) credits to apply in a second
// pass.

export interface PendingCredit {
  beneficiary_id: string;
  beneficiary_role: string;
  pay_week: string;
  amount: number;
  description: string;
  installment_id: string;
  collection_id: string;
}

export interface ApplyInstallmentsResult {
  totalAfterCollections: number;
  linesCreated: number;
  fullyCollected: number;
  partiallyCollected: number;
  credits: PendingCredit[];
}

export async function applyCollectionInstallmentsToDebtor(
  userId: string,
  payfileId: string,
  payWeek: string,
  startingTotal: number,
): Promise<ApplyInstallmentsResult> {
  const result: ApplyInstallmentsResult = {
    totalAfterCollections: startingTotal,
    linesCreated: 0,
    fullyCollected: 0,
    partiallyCollected: 0,
    credits: [],
  };
  if (startingTotal <= 0) return result;

  // Catch up missed weeks plus the current one (scheduled_week <= payWeek).
  // Inner join filters by collection.debtor_id + collection.status = ACTIVE.
  const { data: installments } = await supabase
    .from('collection_installments')
    .select(`
      id, installment_number, scheduled_week, amount, collected_amount,
      collection_id,
      collections!inner(id, description, debtor_id, beneficiary_id, status, installments)
    `)
    .lte('scheduled_week', payWeek)
    .in('status', ['PENDING', 'PARTIALLY_COLLECTED'])
    .eq('collections.debtor_id', userId)
    .eq('collections.status', 'ACTIVE')
    .order('scheduled_week', { ascending: true })
    .order('installment_number', { ascending: true });

  type Row = {
    id: string;
    installment_number: number;
    scheduled_week: string;
    amount: number;
    collected_amount: number;
    collection_id: string;
    collections: {
      id: string;
      description: string;
      debtor_id: string;
      beneficiary_id: string;
      status: CollectionStatus;
      installments: number;
    } | { id: string; description: string; debtor_id: string; beneficiary_id: string; status: CollectionStatus; installments: number }[];
  };

  // Hydrate beneficiary roles in one query.
  const benefIds = Array.from(new Set(
    ((installments ?? []) as Row[]).map((r) => normalizeJoin(r.collections).beneficiary_id),
  ));
  const { data: benefUsers } = benefIds.length
    ? await supabase.from('users').select('id, role').in('id', benefIds)
    : { data: [] };
  const roleByUser = new Map((benefUsers ?? []).map((u) => [u.id, u.role as string]));

  let running = startingTotal;

  for (const row of ((installments ?? []) as Row[])) {
    if (running <= 0) break;
    const coll = normalizeJoin(row.collections);
    const remaining = Number(row.amount) - Number(row.collected_amount);
    if (remaining <= 0) continue;

    const toCollect = Math.min(remaining, running);
    const isFull = toCollect >= remaining;
    const description =
      `Cobro: ${coll.description} parcialidad ${row.installment_number}/${coll.installments}`;

    // Debtor line item (negative).
    const { error: liErr } = await supabase.from('payfile_line_items').insert({
      payfile_id: payfileId,
      line_type: 'COLLECTION' as PayfileLineType,
      description,
      source_collection_id: row.collection_id,
      amount: -toCollect,
      original_amount: -toCollect,
    });
    if (liErr) {
      console.error('[applyCollectionInstallmentsToDebtor] line insert failed:', liErr);
      continue;
    }

    // Update installment.
    const newCollected = Number(row.collected_amount) + toCollect;
    const newStatus = installmentStatusForCollected(newCollected, Number(row.amount));
    await supabase
      .from('collection_installments')
      .update({
        collected_amount: newCollected,
        status: newStatus,
        applied_payfile_id: payfileId,
      })
      .eq('id', row.id);

    // Buffer the beneficiary credit.
    result.credits.push({
      beneficiary_id: coll.beneficiary_id,
      beneficiary_role: roleByUser.get(coll.beneficiary_id) ?? 'agent',
      pay_week: payWeek,
      amount: toCollect,
      description:
        `Abono: ${coll.description} parcialidad ${row.installment_number}/${coll.installments}`,
      installment_id: row.id,
      collection_id: row.collection_id,
    });

    running -= toCollect;
    result.linesCreated += 1;
    if (isFull) result.fullyCollected += 1; else result.partiallyCollected += 1;
  }

  result.totalAfterCollections = running;
  return result;
}

function normalizeJoin<T>(joined: T | T[]): T {
  return Array.isArray(joined) ? joined[0] : joined;
}

// ── creditBeneficiaries ─────────────────────────────────────────────────────
//
// Second-pass: for each (beneficiary, pay_week) bucket, write the
// COLLECTION_INCOME line items into the beneficiary's payfile (or, for CEO,
// into company_bonuses). Returns counts for the caller's summary.

export interface CreditBeneficiariesResult {
  lineItemsCreated: number;
  ceoRecords: number;
  payfilesTouched: string[];
}

export async function creditBeneficiaries(
  credits: PendingCredit[],
): Promise<CreditBeneficiariesResult> {
  const out: CreditBeneficiariesResult = {
    lineItemsCreated: 0,
    ceoRecords: 0,
    payfilesTouched: [],
  };
  const payfilesTouched = new Set<string>();

  for (const credit of credits) {
    // CEO special case: pay is handled outside the system. Record it in
    // company_bonuses for the audit trail and admin's manual settlement.
    if (credit.beneficiary_role === 'ceo') {
      await supabase.from('company_bonuses').insert({
        source_sale_id: null,
        bonus_type: 'MANUAL_BONUS',
        original_je_data: {
          ceo_collection_credit: true,
          installment_id: credit.installment_id,
          collection_id: credit.collection_id,
          description: credit.description,
        },
        total_amount: credit.amount,
        description: credit.description + ' (CEO — pago fuera del sistema)',
        pay_week: credit.pay_week,
      });
      out.ceoRecords += 1;
      continue;
    }

    // Upsert payfile for the beneficiary.
    let payfileId: string;
    const { data: existing } = await supabase
      .from('payfiles')
      .select('id')
      .eq('user_id', credit.beneficiary_id)
      .eq('pay_week', credit.pay_week)
      .maybeSingle();
    if (existing) {
      payfileId = (existing as { id: string }).id;
    } else {
      const { data: created, error: cErr } = await supabase
        .from('payfiles')
        .insert({
          user_id: credit.beneficiary_id,
          pay_week: credit.pay_week,
          state: 'DRAFT',
          total_amount: 0,
        })
        .select('id')
        .single();
      if (cErr || !created) {
        console.error('[creditBeneficiaries] payfile create failed:', cErr);
        continue;
      }
      payfileId = (created as { id: string }).id;
    }

    const { error: liErr } = await supabase.from('payfile_line_items').insert({
      payfile_id: payfileId,
      line_type: 'COLLECTION_INCOME' as PayfileLineType,
      description: credit.description,
      source_collection_id: credit.collection_id,
      amount: credit.amount,
      original_amount: credit.amount,
    });
    if (liErr) {
      console.error('[creditBeneficiaries] line insert failed:', liErr);
      continue;
    }
    out.lineItemsCreated += 1;
    payfilesTouched.add(payfileId);
  }

  out.payfilesTouched = Array.from(payfilesTouched);
  return out;
}

// ── editCollection ──────────────────────────────────────────────────────────
//
// Restricted edits per spec:
//   - description: always editable.
//   - beneficiary: only if NO installment has been collected.
//   - installments count: only if NO installment has been collected
//     (redistributes amount across the new count, regenerates rows).
//
// Audit log captures the before/after.

export interface EditCollectionArgs {
  id: string;
  actor_id: string;
  description?: string;
  beneficiary_id?: string;
  installments?: number;
}

export async function editCollection(args: EditCollectionArgs): Promise<{ ok: boolean; error?: string }> {
  const { data: before } = await supabase
    .from('collections')
    .select('*')
    .eq('id', args.id)
    .maybeSingle();
  if (!before) return { ok: false, error: 'Collection no encontrada.' };
  const beforeRow = before as {
    id: string; status: CollectionStatus; total_amount: number;
    installments: number; start_week: string;
    debtor_id: string; beneficiary_id: string; description: string;
  };
  if (beforeRow.status !== 'ACTIVE') {
    return { ok: false, error: `Collection en estado ${beforeRow.status}, no editable.` };
  }

  const { data: installRows } = await supabase
    .from('collection_installments')
    .select('id, status')
    .eq('collection_id', args.id);
  const hasCollected = (installRows ?? []).some(
    (r) => (r as { status: CollectionInstallmentStatus }).status === 'FULLY_COLLECTED' ||
           (r as { status: CollectionInstallmentStatus }).status === 'PARTIALLY_COLLECTED',
  );

  const patch: Record<string, unknown> = {};
  if (typeof args.description === 'string' && args.description.trim() !== beforeRow.description) {
    patch.description = args.description.trim();
  }

  if (args.beneficiary_id !== undefined && args.beneficiary_id !== beforeRow.beneficiary_id) {
    if (hasCollected) {
      return { ok: false, error: 'No se puede cambiar el beneficiario: ya hay parcialidades cobradas.' };
    }
    // Re-validate beneficiary role.
    const { data: ben } = await supabase
      .from('users')
      .select('id, role')
      .eq('id', args.beneficiary_id)
      .maybeSingle();
    if (!ben) return { ok: false, error: 'Beneficiario no encontrado.' };
    if (!ALLOWED_BENEFICIARY_ROLES.has((ben as { role: string }).role)) {
      return { ok: false, error: 'Beneficiario inválido (admin no permitido).' };
    }
    if (args.beneficiary_id === beforeRow.debtor_id) {
      return { ok: false, error: 'Deudor y beneficiario no pueden ser la misma persona.' };
    }
    patch.beneficiary_id = args.beneficiary_id;
  }

  if (args.installments !== undefined && args.installments !== beforeRow.installments) {
    if (hasCollected) {
      return { ok: false, error: 'No se puede cambiar el número de parcialidades: ya hay cobradas.' };
    }
    if (!Number.isInteger(args.installments) || args.installments < 1) {
      return { ok: false, error: 'installments inválido.' };
    }
    // Regenerate installments.
    await supabase.from('collection_installments').delete().eq('collection_id', args.id);
    const fresh = computeInstallments(
      Number(beforeRow.total_amount),
      args.installments,
      beforeRow.start_week,
    );
    const rows = fresh.map((inst, idx) => ({
      collection_id: args.id,
      installment_number: idx + 1,
      scheduled_week: inst.scheduled_week,
      amount: inst.amount,
      collected_amount: 0,
      status: 'PENDING' as CollectionInstallmentStatus,
    }));
    await supabase.from('collection_installments').insert(rows);
    patch.installments = args.installments;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'Sin cambios.' };
  }

  const { error } = await supabase.from('collections').update(patch).eq('id', args.id);
  if (error) return { ok: false, error: error.message };

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'collection',
    entity_id: args.id,
    action: 'UPDATE',
    actor_id: args.actor_id,
    old_value: beforeRow,
    new_value: patch,
  });
  return { ok: true };
}

// ── cancelCollection ───────────────────────────────────────────────────────

export async function cancelCollection(
  id: string,
  reason: string,
  actorId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: before } = await supabase
    .from('collections')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!before) return { ok: false, error: 'Collection no encontrada.' };
  if ((before as { status: CollectionStatus }).status === 'CANCELLED') {
    return { ok: false, error: 'Ya estaba cancelada.' };
  }
  if ((before as { status: CollectionStatus }).status === 'COMPLETED') {
    return { ok: false, error: 'Collection ya completada — no se puede cancelar.' };
  }

  const { error: cErr } = await supabase
    .from('collections')
    .update({ status: 'CANCELLED' as CollectionStatus })
    .eq('id', id);
  if (cErr) return { ok: false, error: cErr.message };

  // Cancel only the non-collected installments. FULLY_COLLECTED and
  // PARTIALLY_COLLECTED stay as-is (history is sacred).
  await supabase
    .from('collection_installments')
    .update({ status: 'CANCELLED' as CollectionInstallmentStatus })
    .eq('collection_id', id)
    .eq('status', 'PENDING');

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'collection',
    entity_id: id,
    action: 'STATE_CHANGE',
    actor_id: actorId,
    old_value: before,
    new_value: { status: 'CANCELLED' },
    change_notes: `Cancelada: ${reason || '(sin motivo)'}`,
  });
  return { ok: true };
}
