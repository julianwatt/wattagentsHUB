/**
 * Block 07 — Pre-publish gate.
 * ============================================================================
 *
 * Called by the publish flow (block 11) before createPayfileSnapshot runs.
 * Wraps block-05's canPublishWeek with the block-06-specific checks:
 *   - No line item still requires_ceo_approval (3× rule).
 *   - Payfile state is editable (DRAFT or REJECTED → can be re-published
 *     into APPROVED → PUBLISHED). PUBLISHED can also be re-snapshotted
 *     for a v(N+1), so we allow that here too — the *state transition*
 *     decision is block 11's; this only refuses configurations that
 *     would never make sense.
 */

import { supabase } from '@/lib/supabase';
import { canPublishWeek, type CanPublishResult } from '@/lib/payroll/canPublishWeek';

export interface CanPublishPayfileResult extends CanPublishResult {
  pendingCeoApprovalCount: number;
}

export async function canPublishPayfile(payfileId: string): Promise<CanPublishPayfileResult> {
  const { data: pf } = await supabase
    .from('payfiles')
    .select('id, pay_week, state')
    .eq('id', payfileId)
    .maybeSingle();

  if (!pf) {
    return {
      ok: false,
      pendingVerifyCount: 0,
      pendingTierCount: 0,
      pendingCeoApprovalCount: 0,
      details: ['Payfile no encontrado.'],
    };
  }

  // Block-05 weekly checks (VERIFY rows + missing tiers).
  const weekly = await canPublishWeek((pf as { pay_week: string }).pay_week);

  // 3× rule: any line item still flagged requires_ceo_approval blocks.
  const { count } = await supabase
    .from('payfile_line_items')
    .select('id', { count: 'exact', head: true })
    .eq('payfile_id', payfileId)
    .eq('requires_ceo_approval', true);
  const pendingCeo = count ?? 0;

  const details = [...weekly.details];
  if (pendingCeo > 0) {
    details.push(`${pendingCeo} líneas exceden 3× JE y requieren aprobación de CEO.`);
  }

  return {
    ok: weekly.ok && pendingCeo === 0,
    pendingVerifyCount: weekly.pendingVerifyCount,
    pendingTierCount: weekly.pendingTierCount,
    pendingCeoApprovalCount: pendingCeo,
    details,
  };
}
