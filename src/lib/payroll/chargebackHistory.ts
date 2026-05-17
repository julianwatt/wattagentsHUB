/**
 * Block 06 — Historical lookup for chargeback amounts.
 * ============================================================================
 *
 * Master plan §Chargeback: "pagar de vuelta exacto lo que se cobró aunque
 * hoy la tarifa sea distinta". When we charge an agent (or manager) back,
 * we negate the amount that landed in a previous payfile — not the
 * current standard/custom rate, which may have moved.
 *
 * The link is `payroll_sales.contract_id + plan_name`:
 *   - The new CHARGEBACK row carries the contract_id + plan_name.
 *   - The original PAYABLE row had the same pair. Block 04 may have
 *     flipped it to CANCELLED when the chargeback arrived; either way
 *     it's still in payroll_sales.
 *   - We find the payfile_line_item that referenced any such prior sale,
 *     of the relevant line_type (COMMISSION for agent charge, OVERRIDE
 *     for manager override charge), and take its final amount (which
 *     reflects any manual edits).
 *
 * Fallback: if no prior line item exists (the original was never paid —
 * e.g. PAYABLE_NEXT_WEEK that flipped to chargeback before any payfile
 * was generated, or sales from before the migration), return null and
 * let the caller fall back to the current rate.
 */

import { supabase } from '@/lib/supabase';
import type { PayrollSale } from '@/types/payroll';

/**
 * Most recent commission line item paid to anybody for this contract+plan.
 * Returns the amount (positive) or null.
 */
export async function findHistoricalCommission(
  chargebackSale: Pick<PayrollSale, 'id' | 'contract_id' | 'plan_name'>,
): Promise<number | null> {
  // 1. Locate prior sales with the same contract+plan that are NOT this
  //    chargeback row. Status doesn't matter — we want the one that paid.
  const { data: priorSales } = await supabase
    .from('payroll_sales')
    .select('id')
    .eq('contract_id', chargebackSale.contract_id)
    .eq('plan_name', chargebackSale.plan_name)
    .neq('id', chargebackSale.id);
  const priorIds = (priorSales ?? []).map((s) => s.id);
  if (priorIds.length === 0) return null;

  // 2. Find any commission line item that referenced one of those sales.
  //    Newest first, in case the original was edited then re-edited.
  const { data: lineItems } = await supabase
    .from('payfile_line_items')
    .select('amount, created_at')
    .in('source_sale_id', priorIds)
    .eq('line_type', 'COMMISSION')
    .order('created_at', { ascending: false })
    .limit(1);

  const hit = lineItems?.[0];
  return hit ? Number(hit.amount) : null;
}

/**
 * Most recent override line item paid to a specific manager for this
 * contract+plan. Used when computing a manager's chargeback override.
 */
export async function findHistoricalOverride(
  chargebackSale: Pick<PayrollSale, 'id' | 'contract_id' | 'plan_name'>,
  managerUserId: string,
): Promise<number | null> {
  const { data: priorSales } = await supabase
    .from('payroll_sales')
    .select('id')
    .eq('contract_id', chargebackSale.contract_id)
    .eq('plan_name', chargebackSale.plan_name)
    .neq('id', chargebackSale.id);
  const priorIds = (priorSales ?? []).map((s) => s.id);
  if (priorIds.length === 0) return null;

  // Override line items are tied to a payfile owned by the manager — we
  // walk via payfile_overrides (cleaner than joining through payfile_id).
  const { data: overrides } = await supabase
    .from('payfile_overrides')
    .select('amount, created_at')
    .in('sale_id', priorIds)
    .eq('manager_id', managerUserId)
    .order('created_at', { ascending: false })
    .limit(1);

  const hit = overrides?.[0];
  return hit ? Number(hit.amount) : null;
}
