/**
 * Pre-publish validator (Block 03, used by block 11).
 *
 * Returns whether the payfiles for a given pay_week may be published.
 * Currently checks two block-03 conditions:
 *   - No payroll_sales row in that week is still in VERIFY status
 *     (plan_name not mapped yet).
 *   - Every COMMISSION D2D sale has an assigned_tier — the seed mappings
 *     leave tier NULL so admin has to fill it in before payment can run.
 *
 * Later blocks will tack on more conditions (chargebacks resolved,
 * negative balances applied, etc.).
 */

import { supabase } from '@/lib/supabase';

export interface CanPublishResult {
  ok: boolean;
  pendingVerifyCount: number;
  pendingTierCount: number;
  details: string[];
}

export async function canPublishWeek(payWeek: string): Promise<CanPublishResult> {
  const details: string[] = [];

  const { data: verifyRows, error: verifyErr } = await supabase
    .from('payroll_sales')
    .select('id, plan_name')
    .eq('pay_week', payWeek)
    .eq('status', 'VERIFY');
  if (verifyErr) {
    return {
      ok: false,
      pendingVerifyCount: 0,
      pendingTierCount: 0,
      details: [`No se pudo consultar VERIFY: ${verifyErr.message}`],
    };
  }
  const pendingVerify = verifyRows ?? [];
  if (pendingVerify.length > 0) {
    const plans = Array.from(new Set(pendingVerify.map((r) => r.plan_name)));
    details.push(`${pendingVerify.length} ventas con plan no mapeado: ${plans.slice(0, 5).join(', ')}${plans.length > 5 ? '…' : ''}`);
  }

  // Tier gate — only D2D COMMISSION rows need a tier. Joining via two
  // queries because supabase-js doesn't let us filter on the joined
  // plan_type cheaply.
  const { data: d2dCommissionMappings } = await supabase
    .from('plan_mappings')
    .select('id, plan_name')
    .eq('plan_type', 'COMMISSION')
    .eq('campaign', 'D2D');
  const d2dCommissionIds = (d2dCommissionMappings ?? []).map((m) => m.id);

  let pendingTier = 0;
  if (d2dCommissionIds.length > 0) {
    const { data: tierMissingRows } = await supabase
      .from('payroll_sales')
      .select('id, plan_name')
      .eq('pay_week', payWeek)
      .in('plan_mapping_id', d2dCommissionIds)
      .is('assigned_tier', null);
    pendingTier = (tierMissingRows ?? []).length;
    if (pendingTier > 0) {
      const plans = Array.from(new Set((tierMissingRows ?? []).map((r) => r.plan_name)));
      details.push(`${pendingTier} ventas D2D COMMISSION sin tier asignado: ${plans.slice(0, 5).join(', ')}${plans.length > 5 ? '…' : ''}`);
    }
  }

  return {
    ok: pendingVerify.length === 0 && pendingTier === 0,
    pendingVerifyCount: pendingVerify.length,
    pendingTierCount: pendingTier,
    details,
  };
}
