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
import type { PlanMapping } from '@/types/payroll';
import type { PlanType } from '@/lib/payroll/constants';

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
 * Auto-reprocess hook: every time a mapping is created or its plan_type
 * changes, every payroll_sales row currently sitting on VERIFY with that
 * exact plan_name should pick up the new mapping. Returns the count of
 * rows touched so callers can surface "X ventas resueltas" to admin.
 */
export async function reprocessVerifyRowsForPlan(planName: string): Promise<number> {
  const mapping = await resolvePlanMapping(planName);
  if (!mapping) return 0;

  const { data: hits, error } = await supabase
    .from('payroll_sales')
    .select('id')
    .eq('plan_name', planName)
    .eq('status', 'VERIFY');
  if (error || !hits || hits.length === 0) return 0;

  const newStatus = defaultStatusForPlanType(mapping.plan_type);
  const { error: updErr } = await supabase
    .from('payroll_sales')
    .update({
      plan_mapping_id: mapping.id,
      status: newStatus,
    })
    .in('id', hits.map((h) => h.id));
  if (updErr) {
    console.error('[reprocessVerifyRowsForPlan] update failed:', updErr);
    return 0;
  }
  return hits.length;
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
