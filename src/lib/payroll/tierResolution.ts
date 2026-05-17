/**
 * Block 05 — Pure tier/term resolution.
 * ============================================================================
 *
 * Two single-purpose, deterministic functions used everywhere that has to
 * decide "what tier should this sale pay at" and "what term row in
 * payroll_standard_rates does it look up against".
 *
 * No DB access here. Callers fetch the sale + plan mapping and hand both in.
 * That makes the functions trivially testable, lets the parser and the
 * reprocess pass share the exact same logic, and keeps "is this thing pure?"
 * unambiguous.
 *
 * Rules per master plan §Tier:
 *   - Tier belongs to the PLAN (not the agent). Same plan = same tier.
 *   - D2D COMMISSION → tier from plan_mapping.tier (may be NULL if admin
 *     hasn't seeded it; block 11 canPublishWeek() blocks publication).
 *   - Retail → tier doesn't apply (NULL).
 *   - RCE adders / residuals / green bonuses / manual bonuses → NULL.
 *
 * Rules per master plan §Term:
 *   - Term applies to D2D COMMISSION lookups (D2D pays differently at 36 vs 60).
 *   - For plans whose plan_name embeds the term explicitly (e.g.
 *     "Watts - Texas - ELE - D2D - 60 - 0.7 - 1.19 RCE - $305"), the mapping
 *     row carries it. That value wins.
 *   - For Retail plans whose plan_name is "36/60" (term reads from the file),
 *     fall back to raw_term_months (parsed in block 04 from the
 *     "Contract Term (months)" column).
 *   - Both NULL → flag missing; canPublishWeek() will refuse the week.
 */

import type { PlanMapping, PayrollSale } from '@/types/payroll';

/**
 * Returns the tier this sale's commission should be paid at, or NULL if
 * tier doesn't apply (non-D2D, non-COMMISSION) or the mapping hasn't been
 * tier-tagged yet.
 */
export function resolveTierForSale(
  _sale: Pick<PayrollSale, 'plan_mapping_id'>,
  mapping: PlanMapping | null,
): number | null {
  if (!mapping) return null;
  if (mapping.campaign !== 'D2D') return null;
  if (mapping.plan_type !== 'COMMISSION') return null;
  return mapping.tier; // may itself be null until admin tier-tags the mapping
}

export interface TermResolution {
  /** The term to use for rate lookups, or NULL if not applicable / missing. */
  value: number | null;
  /** True iff the term should have been set but neither source had it. */
  missing: boolean;
}

/**
 * Returns the term months to use for rate lookups. Only D2D COMMISSION
 * sales actually need a term — every other plan type returns NULL with
 * missing=false.
 */
export function resolveTermMonthsForSale(
  sale: Pick<PayrollSale, 'raw_term_months'>,
  mapping: PlanMapping | null,
): TermResolution {
  if (!mapping) return { value: null, missing: false };
  if (mapping.campaign !== 'D2D' || mapping.plan_type !== 'COMMISSION') {
    return { value: null, missing: false };
  }
  if (mapping.term_months !== null) {
    return { value: mapping.term_months, missing: false };
  }
  if (sale.raw_term_months !== null) {
    return { value: sale.raw_term_months, missing: false };
  }
  // D2D COMMISSION with no term anywhere — admin needs to fix the mapping
  // or re-parse the source row.
  return { value: null, missing: true };
}
