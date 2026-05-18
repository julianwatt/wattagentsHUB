/**
 * Block 11 — payfile state machine.
 * ============================================================================
 *
 *   [DRAFT]
 *     │  submit (admin) — canPublishPayfile must pass
 *     ▼
 *   [PENDING_APPROVAL]
 *     │  approve (CEO) — auto-publishes via createPayfileSnapshot
 *     │  reject (CEO)  — back to DRAFT with rejection_notes
 *     ▼
 *   [APPROVED] ─ internal transient ─▶ [PUBLISHED]
 *
 *   [PUBLISHED]
 *     │  reopen (admin / CEO) — back to DRAFT
 *     │  republish (admin) — if |diff vs last snapshot| ≤ $500, jumps
 *     │                       straight to PUBLISHED (new version). Else
 *     │                       refused and must take the approval path.
 *     ▼
 *   [DRAFT]
 *
 *   [REJECTED] is never persisted as a stable state — `reject` flips
 *   directly to DRAFT and stores the reason in payfile.rejection_notes.
 *
 * Every transition writes a payroll_audit_log entry. Publishing also
 * runs createPayfileSnapshot (block 07) and the publish-time push
 * notifier (block 11).
 *
 * Server-side only.
 */

import { supabase } from '@/lib/supabase';
import { canPublishPayfile, type CanPublishPayfileResult } from '@/lib/payroll/canPublishPayfile';
import { createPayfileSnapshot } from '@/lib/payroll/publishPayfile';
import { calculatePayfileDiffSinceLastVersion } from '@/lib/payroll/payfileDiff';
import { notifyPayfilePublished } from '@/lib/payroll/payfileNotify';
import { dispatchPayrollNotification, PAYROLL_NOTIFICATION_TYPES } from '@/lib/payroll/notifications';
import { REPUBLISH_REAPPROVAL_THRESHOLD_USD } from '@/lib/payroll/constants';
import type { PayfileState } from '@/lib/payroll/constants';

// ── Types ──────────────────────────────────────────────────────────────────

export interface TransitionResult {
  ok: boolean;
  new_state?: PayfileState;
  error?: string;
  /** Populated on transitions that publish a new version. */
  version_number?: number;
  /** Pre-publish gate state, included on submit / approve / republish. */
  gate?: CanPublishPayfileResult;
}

export interface ActorCtx {
  user_id: string;
  role: 'agent' | 'jr_manager' | 'sr_manager' | 'admin' | 'ceo' | string;
}

const ADMIN_OR_CEO = new Set(['admin', 'ceo']);
const CEO_ONLY = new Set(['ceo']);

// ── submitForApproval ──────────────────────────────────────────────────────

export async function submitForApproval(
  payfileId: string,
  actor: ActorCtx,
): Promise<TransitionResult> {
  if (!ADMIN_OR_CEO.has(actor.role)) return fail('Solo Admin o CEO pueden enviar a aprobación.');

  const { data: pf } = await supabase
    .from('payfiles')
    .select('id, state, pay_week, user_id')
    .eq('id', payfileId)
    .maybeSingle();
  if (!pf) return fail('Payfile no encontrado.');
  const state = (pf as { state: PayfileState }).state;
  if (state !== 'DRAFT' && state !== 'REJECTED') {
    return fail(`Payfile en estado ${state}, no se puede enviar a aprobación.`);
  }

  // Must have at least one line item to be worth approving.
  const { count: liCount } = await supabase
    .from('payfile_line_items')
    .select('id', { count: 'exact', head: true })
    .eq('payfile_id', payfileId);
  if ((liCount ?? 0) === 0) return fail('El payfile no tiene líneas. Recalcula antes de enviar a aprobación.');

  const gate = await canPublishPayfile(payfileId);
  if (!gate.ok) return { ok: false, error: 'gate_failed', gate };

  const { error } = await supabase
    .from('payfiles')
    .update({
      state: 'PENDING_APPROVAL',
      submitted_to_ceo_at: new Date().toISOString(),
      rejection_notes: null,
    })
    .eq('id', payfileId);
  if (error) return fail(error.message);

  await audit(payfileId, actor.user_id, 'DRAFT', 'PENDING_APPROVAL', 'Enviado a aprobación CEO.');

  // Block 15 — notify the CEO. If this is a republish whose delta exceeds
  // the $500 threshold, use the more pointed LARGE_CHANGE_REPUBLISH copy
  // so the CEO knows why approval is required this time.
  await fireSubmitForApprovalNotifications(payfileId, (pf as { pay_week: string }).pay_week);

  return { ok: true, new_state: 'PENDING_APPROVAL', gate };
}

async function fireSubmitForApprovalNotifications(payfileId: string, payWeek: string) {
  try {
    const ceos = await fetchCeoIds();
    if (ceos.length === 0) return;

    // Count items >3x still pending CEO approval (block 11 flag).
    const { count: over3xCount } = await supabase
      .from('payfile_line_items')
      .select('id', { count: 'exact', head: true })
      .eq('payfile_id', payfileId)
      .eq('requires_ceo_approval', true);

    const diff = await calculatePayfileDiffSinceLastVersion(payfileId);
    const isLargeRepublish =
      !diff.is_first_publish && diff.abs_diff > REPUBLISH_REAPPROVAL_THRESHOLD_USD;

    for (const ceoId of ceos) {
      if (isLargeRepublish) {
        await dispatchPayrollNotification({
          type: PAYROLL_NOTIFICATION_TYPES.LARGE_CHANGE_REPUBLISH_PENDING,
          recipient_user_id: ceoId,
          payload: {
            payfile_id: payfileId,
            pay_week: payWeek,
            abs_diff: diff.abs_diff,
            threshold: REPUBLISH_REAPPROVAL_THRESHOLD_USD,
          },
        });
      } else {
        await dispatchPayrollNotification({
          type: PAYROLL_NOTIFICATION_TYPES.WEEK_READY_FOR_APPROVAL,
          recipient_user_id: ceoId,
          payload: { payfile_id: payfileId, pay_week: payWeek },
        });
      }
      if ((over3xCount ?? 0) > 0) {
        await dispatchPayrollNotification({
          type: PAYROLL_NOTIFICATION_TYPES.ITEMS_OVER_3X_PENDING,
          recipient_user_id: ceoId,
          payload: { payfile_id: payfileId, pay_week: payWeek, count: over3xCount },
          channels: ['inapp'],
        });
      }
    }
  } catch (err) {
    console.error('[fireSubmitForApprovalNotifications] failed:', err);
  }
}

async function fetchCeoIds(): Promise<string[]> {
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'ceo')
    .eq('is_active', true);
  return (data ?? []).map((u) => u.id);
}


// ── approve ────────────────────────────────────────────────────────────────

export async function approveAndPublish(
  payfileId: string,
  actor: ActorCtx,
): Promise<TransitionResult> {
  if (!CEO_ONLY.has(actor.role)) return fail('Solo el CEO puede aprobar y publicar.');

  const { data: pf } = await supabase
    .from('payfiles')
    .select('id, state, total_amount')
    .eq('id', payfileId)
    .maybeSingle();
  if (!pf) return fail('Payfile no encontrado.');
  if ((pf as { state: PayfileState }).state !== 'PENDING_APPROVAL') {
    return fail(`Payfile en estado ${(pf as { state: PayfileState }).state}, no está en aprobación.`);
  }

  const gate = await canPublishPayfile(payfileId);
  if (!gate.ok) return { ok: false, error: 'gate_failed', gate };

  const nowIso = new Date().toISOString();

  // 1. Mark APPROVED first so the snapshot row's published_by aligns with
  //    the approve step. If snapshot fails we roll back to PENDING_APPROVAL.
  const { error: upErr } = await supabase
    .from('payfiles')
    .update({
      state: 'APPROVED',
      approved_by_ceo_at: nowIso,
      approved_by: actor.user_id,
    })
    .eq('id', payfileId);
  if (upErr) return fail(upErr.message);

  // 2. Capture the prior total before the snapshot — block 11's
  //    notifier uses it to pick the "first" vs "update" copy.
  const diff = await calculatePayfileDiffSinceLastVersion(payfileId);

  let versionNumber: number | undefined;
  try {
    const result = await createPayfileSnapshot(payfileId, actor.user_id);
    versionNumber = result.version.version_number;
  } catch (err) {
    // Rollback to PENDING_APPROVAL so the CEO can retry.
    await supabase
      .from('payfiles')
      .update({ state: 'PENDING_APPROVAL', approved_by_ceo_at: null, approved_by: null })
      .eq('id', payfileId);
    return fail(`snapshot falló: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. PUBLISHED.
  await supabase
    .from('payfiles')
    .update({ state: 'PUBLISHED', published_at: nowIso })
    .eq('id', payfileId);

  await audit(payfileId, actor.user_id, 'PENDING_APPROVAL', 'PUBLISHED', `Aprobado y publicado v${versionNumber}.`);

  // 4. Notify the recipient.
  await notifyPayfilePublished({
    payfile_id: payfileId,
    current_total: Number((pf as { total_amount: number }).total_amount),
    prior_total: diff.prior_total,
  });

  return { ok: true, new_state: 'PUBLISHED', version_number: versionNumber, gate };
}

// ── reject ─────────────────────────────────────────────────────────────────

export async function reject(
  payfileId: string,
  actor: ActorCtx,
  notes: string,
): Promise<TransitionResult> {
  if (!CEO_ONLY.has(actor.role)) return fail('Solo el CEO puede rechazar.');
  if (!notes?.trim()) return fail('Las notas de rechazo son obligatorias.');

  const { data: pf } = await supabase
    .from('payfiles')
    .select('id, state')
    .eq('id', payfileId)
    .maybeSingle();
  if (!pf) return fail('Payfile no encontrado.');
  if ((pf as { state: PayfileState }).state !== 'PENDING_APPROVAL') {
    return fail(`Payfile en estado ${(pf as { state: PayfileState }).state}, no está en aprobación.`);
  }

  const { error } = await supabase
    .from('payfiles')
    .update({
      state: 'DRAFT',
      rejection_notes: notes.trim(),
      submitted_to_ceo_at: null,
    })
    .eq('id', payfileId);
  if (error) return fail(error.message);

  await audit(payfileId, actor.user_id, 'PENDING_APPROVAL', 'DRAFT', `Rechazado por CEO: ${notes.trim()}`);

  // Block 15 — admin inbox alert so the admin sees the rejection in
  // the bell without having to navigate to the approval tab.
  try {
    const { data: pf2 } = await supabase
      .from('payfiles')
      .select('pay_week, user_id')
      .eq('id', payfileId)
      .maybeSingle();
    const { data: owner } = pf2
      ? await supabase.from('users').select('name').eq('id', (pf2 as { user_id: string }).user_id).maybeSingle()
      : { data: null };
    await dispatchPayrollNotification({
      type: PAYROLL_NOTIFICATION_TYPES.WEEK_REJECTED_BY_CEO,
      payload: {
        payfile_id: payfileId,
        pay_week: (pf2 as { pay_week?: string } | null)?.pay_week ?? '',
        notes: notes.trim(),
        owner_name: (owner as { name?: string } | null)?.name ?? null,
      },
      channels: ['inapp'],
    });
  } catch (err) {
    console.error('[reject] notify failed:', err);
  }

  return { ok: true, new_state: 'DRAFT' };
}

// ── reopen ─────────────────────────────────────────────────────────────────

export async function reopen(
  payfileId: string,
  actor: ActorCtx,
  reason: string,
): Promise<TransitionResult> {
  if (!ADMIN_OR_CEO.has(actor.role)) return fail('Solo Admin o CEO pueden reabrir.');

  const { data: pf } = await supabase
    .from('payfiles')
    .select('id, state')
    .eq('id', payfileId)
    .maybeSingle();
  if (!pf) return fail('Payfile no encontrado.');
  const state = (pf as { state: PayfileState }).state;
  if (state !== 'PUBLISHED' && state !== 'APPROVED') {
    return fail(`Payfile en estado ${state}, no se puede reabrir.`);
  }

  const { error } = await supabase
    .from('payfiles')
    .update({ state: 'DRAFT' })
    .eq('id', payfileId);
  if (error) return fail(error.message);

  await audit(
    payfileId,
    actor.user_id,
    state,
    'DRAFT',
    `Reabierto por ${actor.role}${reason ? ': ' + reason : ''}. Histórico de versiones intacto.`,
  );
  return { ok: true, new_state: 'DRAFT' };
}

// ── republish (DRAFT → PUBLISHED bypass when diff ≤ $500) ─────────────────

export async function republish(
  payfileId: string,
  actor: ActorCtx,
): Promise<TransitionResult> {
  if (!ADMIN_OR_CEO.has(actor.role)) return fail('Solo Admin o CEO pueden republicar.');

  const { data: pf } = await supabase
    .from('payfiles')
    .select('id, state, total_amount, last_version_number')
    .eq('id', payfileId)
    .maybeSingle();
  if (!pf) return fail('Payfile no encontrado.');
  const state = (pf as { state: PayfileState }).state;
  if (state !== 'DRAFT' && state !== 'REJECTED') {
    return fail(`Payfile en estado ${state}, no se puede republicar.`);
  }

  const gate = await canPublishPayfile(payfileId);
  if (!gate.ok) return { ok: false, error: 'gate_failed', gate };

  const diff = await calculatePayfileDiffSinceLastVersion(payfileId);
  if (diff.is_first_publish) {
    return fail('Este payfile nunca se ha publicado. Envíalo a aprobación del CEO primero.');
  }
  if (!diff.within_threshold) {
    return fail(`Diferencia $${diff.abs_diff.toFixed(2)} excede el umbral de $${diff.threshold}. Envíalo a aprobación del CEO.`);
  }

  const nowIso = new Date().toISOString();
  let versionNumber: number | undefined;
  try {
    const result = await createPayfileSnapshot(payfileId, actor.user_id);
    versionNumber = result.version.version_number;
  } catch (err) {
    return fail(`snapshot falló: ${err instanceof Error ? err.message : String(err)}`);
  }

  await supabase
    .from('payfiles')
    .update({ state: 'PUBLISHED', published_at: nowIso })
    .eq('id', payfileId);

  await audit(payfileId, actor.user_id, state, 'PUBLISHED', `Republicado v${versionNumber} (diff $${diff.abs_diff.toFixed(2)} ≤ $${diff.threshold}).`);

  await notifyPayfilePublished({
    payfile_id: payfileId,
    current_total: Number((pf as { total_amount: number }).total_amount),
    prior_total: diff.prior_total,
  });

  return { ok: true, new_state: 'PUBLISHED', version_number: versionNumber, gate };
}

// ── approve3xLine ──────────────────────────────────────────────────────────

export async function approve3xLine(
  lineItemId: string,
  actor: ActorCtx,
): Promise<{ ok: boolean; error?: string }> {
  if (!CEO_ONLY.has(actor.role)) return { ok: false, error: 'Solo el CEO puede aprobar ajustes que exceden 3×.' };

  const { data: li } = await supabase
    .from('payfile_line_items')
    .select('id, payfile_id, requires_ceo_approval, is_over_3x_received')
    .eq('id', lineItemId)
    .maybeSingle();
  if (!li) return { ok: false, error: 'Line item no encontrado.' };
  if (!(li as { requires_ceo_approval: boolean }).requires_ceo_approval) {
    return { ok: false, error: 'Este line item no requiere aprobación adicional.' };
  }

  const { error } = await supabase
    .from('payfile_line_items')
    .update({ requires_ceo_approval: false })
    .eq('id', lineItemId);
  if (error) return { ok: false, error: error.message };

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'payfile_line_item',
    entity_id: lineItemId,
    action: 'STATE_CHANGE',
    actor_id: actor.user_id,
    change_notes: 'CEO aprobó ajuste >3× individualmente.',
  });

  return { ok: true };
}

// ── helpers ────────────────────────────────────────────────────────────────

function fail(error: string): TransitionResult { return { ok: false, error }; }

async function audit(
  payfileId: string,
  actorId: string,
  fromState: PayfileState,
  toState: PayfileState,
  notes: string,
): Promise<void> {
  await supabase.from('payroll_audit_log').insert({
    entity_type: 'payfile',
    entity_id: payfileId,
    action: 'STATE_CHANGE',
    actor_id: actorId,
    old_value: { state: fromState },
    new_value: { state: toState },
    change_notes: notes,
  });
}
