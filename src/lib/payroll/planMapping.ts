/**
 * Plan-mapping resolution helpers (Block 03).
 *
 * Single source of truth for "what does this plan_name mean in payroll?".
 * Used during file parsing (block 04) and any reprocess pass after admin
 * adds or edits a mapping.
 *
 * All functions are server-only — they hit Supabase with the service-role
 * client. Do not import from any client component.
 */

import { supabase } from '@/lib/supabase';
import type { PlanMapping, PayrollSale } from '@/types/payroll';
import type { PlanType } from '@/lib/payroll/constants';
import { resolveTierForSale, resolveTermMonthsForSale } from '@/lib/payroll/tierResolution';

/** Resolve a plan_name to its mapping, or null if no row exists yet. */
export async function resolvePlanMapping(planName: string): Promise<PlanMapping | null> {
  if (!planName) return null;
  const { data, error } = await supabase
    .from('plan_mappings')
    .select('*')
    .eq('plan_name', planName)
    .maybeSingle();
  if (error) {
    console.error('[resolvePlanMapping] supabase error:', error);
    return null;
  }
  return (data as PlanMapping) ?? null;
}

/**
 * Mark a payroll_sales row as VERIFY because its plan_name has no mapping.
 * Idempotent — calling twice with the same sale is fine. Returns true if
 * the update succeeded.
 */
export async function markSaleAsVerify(saleId: string, reason: string): Promise<boolean> {
  const { error } = await supabase
    .from('payroll_sales')
    .update({
      status: 'VERIFY',
      plan_mapping_id: null,
      notes: reason,
    })
    .eq('id', saleId);
  if (error) {
    console.error('[markSaleAsVerify] update failed:', error);
    return false;
  }
  return true;
}

/**
 * Map a freshly-resolved plan_type to the sale status it should land on
 * after processing (excluding date / chargeback considerations — those
 * are layered on top in block 05). Anything that is NOT paid to the agent
 * (RCE adders, residuals, manual bonuses) leaves the sale as PAYABLE so
 * downstream code can read it as a regular row; the actual splitting into
 * company_bonuses / residuals tables happens in block 10. For now the
 * status reflects the simplest possible interpretation.
 */
export function defaultStatusForPlanType(planType: PlanType): 'PAYABLE' | 'VERIFY' {
  switch (planType) {
    case 'COMMISSION':
    case 'RCE_ADDER_D2D':
    case 'RCE_ADDER_RETAIL':
    case 'RESIDUAL_D2D':
    case 'GREEN_BONUS':
    case 'MANUAL_BONUS':
      return 'PAYABLE';
    default:
      return 'VERIFY';
  }
}

/**
 * Auto-reprocess hook: when a plan_mapping is created or edited, every
 * payroll_sales row with that plan_name picks up the new state. This runs
 * for VERIFY rows (where status flips to PAYABLE/etc.) AND for rows that
 * are already classified but whose tier/term might have changed when admin
 * tier-tagged the mapping after the fact.
 *
 * Updates per sale (only when the new value differs from the stored one):
 *   - plan_mapping_id   → from resolvePlanMapping(plan_name)
 *   - assigned_tier     → from resolveTierForSale
 *   - assigned_term_months → from resolveTermMonthsForSale
 *   - status            → if VERIFY, advance to defaultStatusForPlanType
 *                          (chargebacks are left alone — block 04 already
 *                           gave them the correct status)
 *   - pay_week          → if transitioning out of VERIFY, copy from the
 *                         owning upload's pay_week
 *
 * Idempotent: a second call with no changes returns count=0 and writes
 * nothing.
 *
 * Returns the number of sale rows that received any update.
 */
export async function reprocessVerifyRowsForPlan(planName: string): Promise<number> {
  const mapping = await resolvePlanMapping(planName);
  if (!mapping) return 0;

  // Pull every sale for this plan_name. We process VERIFY rows AND already-
  // classified rows whose tier/term might need refreshing.
  const { data: salesData, error } = await supabase
    .from('payroll_sales')
    .select(`
      id, status, plan_mapping_id, assigned_tier, assigned_term_months,
      raw_term_months, pay_week, upload_id
    `)
    .eq('plan_name', planName);
  if (error || !salesData || salesData.length === 0) return 0;

  type SaleSlice = Pick<
    PayrollSale,
    'id' | 'status' | 'plan_mapping_id' | 'assigned_tier' | 'assigned_term_months'
    | 'raw_term_months' | 'pay_week' | 'upload_id'
  >;
  const sales = salesData as SaleSlice[];

  // Load upload pay_weeks in batch — needed when transitioning VERIFY → real.
  const uploadIds = Array.from(new Set(sales.map((s) => s.upload_id)));
  const { data: uploads } = await supabase
    .from('payroll_uploads')
    .select('id, pay_week, cutoff_date')
    .in('id', uploadIds);
  const uploadById = new Map(
    (uploads ?? []).map((u) => [u.id, u as { id: string; pay_week: string | null; cutoff_date: string }]),
  );

  let touched = 0;

  for (const sale of sales) {
    const patch: Record<string, unknown> = {};

    // plan_mapping_id
    if (sale.plan_mapping_id !== mapping.id) {
      patch.plan_mapping_id = mapping.id;
    }

    // assigned_tier
    const tier = resolveTierForSale({ plan_mapping_id: mapping.id }, mapping);
    if (tier !== sale.assigned_tier) patch.assigned_tier = tier;

    // assigned_term_months
    const term = resolveTermMonthsForSale(
      { raw_term_months: sale.raw_term_months },
      mapping,
    );
    if (term.value !== sale.assigned_term_months) {
      patch.assigned_term_months = term.value;
    }

    // status + pay_week (only when leaving VERIFY)
    if (sale.status === 'VERIFY') {
      patch.status = defaultStatusForPlanType(mapping.plan_type);
      const upload = uploadById.get(sale.upload_id);
      if (upload?.pay_week) {
        patch.pay_week = upload.pay_week;
      }
    }

    if (Object.keys(patch).length > 0) {
      const { error: updErr } = await supabase
        .from('payroll_sales')
        .update(patch)
        .eq('id', sale.id);
      if (!updErr) touched += 1;
    }
  }

  return touched;
}

/**
 * Block 05 — re-resolve internal_agent_id on every payroll_sales row that
 * matches the given je_badge but is still missing the user link. Called by
 * the Roster badge endpoints after a badge is registered or re-pointed.
 *
 * Idempotent. Returns the number of sales updated.
 */
export async function reprocessSalesForBadge(
  jeBadge: string,
  userId: string,
): Promise<number> {
  if (!jeBadge || !userId) return 0;
  const { data, error } = await supabase
    .from('payroll_sales')
    .update({ internal_agent_id: userId })
    .eq('je_badge', jeBadge)
    .is('internal_agent_id', null)
    .neq('status', 'CANCELLED')
    .select('id');
  if (error) {
    console.error('[reprocessSalesForBadge] failed:', error);
    return 0;
  }
  return (data ?? []).length;
}


/**
 * Return the unique plan_names currently sitting on VERIFY (and how many
 * sale rows each one accounts for). Drives the "Planes pendientes" panel
 * in the Plan Mapping tab. The panel is empty until block 04 actually
 * parses files and writes VERIFY rows.
 */
export interface PendingPlanRow {
  plan_name: string;
  sale_count: number;
  first_seen_at: string;
}

export async function listPendingPlans(): Promise<PendingPlanRow[]> {
  const { data, error } = await supabase
    .from('payroll_sales')
    .select('plan_name, created_at')
    .eq('status', 'VERIFY');
  if (error || !data) return [];
  const acc = new Map<string, { count: number; first: string }>();
  for (const row of data as { plan_name: string; created_at: string }[]) {
    const entry = acc.get(row.plan_name);
    if (entry) {
      entry.count += 1;
      if (row.created_at < entry.first) entry.first = row.created_at;
    } else {
      acc.set(row.plan_name, { count: 1, first: row.created_at });
    }
  }
  return Array.from(acc.entries())
    .map(([plan_name, v]) => ({ plan_name, sale_count: v.count, first_seen_at: v.first }))
    .sort((a, b) => b.sale_count - a.sale_count);
}
