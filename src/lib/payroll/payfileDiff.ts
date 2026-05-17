/**
 * Block 11 — payfile diff vs last published snapshot.
 * ============================================================================
 *
 * Used by the republish flow: if an admin reopens a PUBLISHED payfile,
 * edits, and tries to publish again, we compare the current total against
 * the snapshot of the most recent payfile_versions row.
 *   - |diff| ≤ REPUBLISH_REAPPROVAL_THRESHOLD_USD ($500) → admin may
 *     publish directly (new version, fresh PDF, push).
 *   - |diff|  > threshold                                → must route
 *     back through PENDING_APPROVAL.
 *
 * Diff is on the total_amount only — block 11's spec doesn't require a
 * line-by-line comparison.
 *
 * Server-side only.
 */

import { supabase } from '@/lib/supabase';
import { REPUBLISH_REAPPROVAL_THRESHOLD_USD } from '@/lib/payroll/constants';

export interface PayfileDiff {
  abs_diff: number;
  prior_total: number | null;
  current_total: number;
  prior_version_number: number | null;
  /** TRUE when republish can skip CEO approval. */
  within_threshold: boolean;
  threshold: number;
  /** TRUE if there's no prior version — caller must take "first publish" path. */
  is_first_publish: boolean;
}

export async function calculatePayfileDiffSinceLastVersion(
  payfileId: string,
): Promise<PayfileDiff> {
  const { data: payfile } = await supabase
    .from('payfiles')
    .select('id, total_amount, last_version_number')
    .eq('id', payfileId)
    .maybeSingle();
  if (!payfile) throw new Error(`Payfile ${payfileId} no encontrado.`);
  const current = Number((payfile as { total_amount: number }).total_amount);

  const lastVersionNumber = (payfile as { last_version_number: number }).last_version_number;
  if (!lastVersionNumber || lastVersionNumber < 1) {
    return {
      abs_diff: 0,
      prior_total: null,
      current_total: current,
      prior_version_number: null,
      within_threshold: false,
      threshold: REPUBLISH_REAPPROVAL_THRESHOLD_USD,
      is_first_publish: true,
    };
  }

  const { data: version } = await supabase
    .from('payfile_versions')
    .select('version_number, snapshot_json')
    .eq('payfile_id', payfileId)
    .eq('version_number', lastVersionNumber)
    .maybeSingle();

  if (!version) {
    // last_version_number says we have history but the row is missing —
    // treat as first publish for safety.
    return {
      abs_diff: 0,
      prior_total: null,
      current_total: current,
      prior_version_number: null,
      within_threshold: false,
      threshold: REPUBLISH_REAPPROVAL_THRESHOLD_USD,
      is_first_publish: true,
    };
  }

  const snap = (version as { snapshot_json: { payfile?: { total_amount?: number } } }).snapshot_json;
  const priorTotal = Number(snap?.payfile?.total_amount ?? 0);
  const abs = Math.abs(current - priorTotal);

  return {
    abs_diff: abs,
    prior_total: priorTotal,
    current_total: current,
    prior_version_number: (version as { version_number: number }).version_number,
    within_threshold: abs <= REPUBLISH_REAPPROVAL_THRESHOLD_USD,
    threshold: REPUBLISH_REAPPROVAL_THRESHOLD_USD,
    is_first_publish: false,
  };
}
