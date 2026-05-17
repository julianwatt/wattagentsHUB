/**
 * Block 05 — Applicable-rate resolution + pay-week sales + validation.
 * ============================================================================
 *
 * `resolveApplicableRate` is the only function in the codebase that returns
 * a $ amount for a (campaign, tier, term, position, manager_level, rate_type,
 * pay_week) lookup. Block 06's commission calculator goes through it; the
 * UI calls it for previews. There is no other place where rate numbers live.
 *
 * Lookup order:
 *   1. roster_custom_rates for that user (vigent for the pay_week).
 *      - COMMISSION  → custom.commission_amount  (NOT NULL in the schema)
 *      - OVERRIDE_DIRECT → custom.override_amount (NULL falls through)
 *      - OVERRIDE_INDIRECT → not supported in custom today; always
 *        falls through to standard. Documented in code; if Julian needs
 *        custom indirect overrides later we extend roster_custom_rates.
 *   2. payroll_standard_rates exact match on the same combo (vigent for
 *      the pay_week).
 *   3. NULL — caller reports "no rate found" and calc fails for that row.
 *
 * Server-side only. Never import from a client component.
 */

import { supabase } from '@/lib/supabase';
import type {
  PayrollSale, PlanMapping, RosterCustomRate,
} from '@/types/payroll';
import type {
  RosterCampaign, RosterPosition, ManagerLevel, SaleStatus,
} from '@/lib/payroll/constants';

// ── Types ────────────────────────────────────────────────────────────────────

export type PayrollRateType = 'COMMISSION' | 'OVERRIDE_DIRECT' | 'OVERRIDE_INDIRECT';

export interface ResolveApplicableRateArgs {
  user_id: string | null; // null = skip custom-rate check
  campaign: RosterCampaign;
  tier: number | null;
  term_months: number | null;
  position: RosterPosition;
  manager_level: ManagerLevel | null;
  rate_type: PayrollRateType;
  /** ISO YYYY-MM-DD. Rate is valid_from ≤ pay_week ≤ valid_until (or NULL). */
  pay_week: string;
}

export interface ResolvedRate {
  amount: number;
  source: 'custom' | 'standard';
  source_row_id: string;
}

export interface PayrollStandardRate {
  id: string;
  campaign: RosterCampaign;
  tier: number | null;
  term_months: number | null;
  position: RosterPosition;
  manager_level: ManagerLevel | null;
  rate_type: PayrollRateType;
  amount: number;
  valid_from: string;
  valid_until: string | null;
  notes: string | null;
}

// ── resolveApplicableRate ────────────────────────────────────────────────────

export async function resolveApplicableRate(
  args: ResolveApplicableRateArgs,
): Promise<ResolvedRate | null> {
  // ── 1. Custom rate for this user ─────────────────────────────────────────
  if (args.user_id) {
    const { data: customRows } = await supabase
      .from('roster_custom_rates')
      .select('*')
      .eq('user_id', args.user_id)
      .eq('campaign', args.campaign)
      .lte('valid_from', args.pay_week)
      .or(`valid_until.is.null,valid_until.gte.${args.pay_week}`);

    const customMatch = (customRows ?? []).find((r: RosterCustomRate) =>
      (r.tier ?? null) === (args.tier ?? null) &&
      (r.term_months ?? null) === (args.term_months ?? null),
    );

    if (customMatch) {
      const customAmount =
        args.rate_type === 'COMMISSION'      ? customMatch.commission_amount :
        args.rate_type === 'OVERRIDE_DIRECT' ? customMatch.override_amount :
        /* OVERRIDE_INDIRECT */                null;
      if (customAmount !== null && customAmount !== undefined) {
        return { amount: Number(customAmount), source: 'custom', source_row_id: customMatch.id };
      }
      // Custom row exists but doesn't cover this rate_type — fall through.
    }
  }

  // ── 2. Standard rate ─────────────────────────────────────────────────────
  const { data: stdRows } = await supabase
    .from('payroll_standard_rates')
    .select('*')
    .eq('campaign', args.campaign)
    .eq('position', args.position)
    .eq('rate_type', args.rate_type)
    .lte('valid_from', args.pay_week)
    .or(`valid_until.is.null,valid_until.gte.${args.pay_week}`);

  const stdMatch = (stdRows ?? []).find((r: PayrollStandardRate) =>
    (r.tier ?? null) === (args.tier ?? null) &&
    (r.term_months ?? null) === (args.term_months ?? null) &&
    (r.manager_level ?? null) === (args.manager_level ?? null),
  );

  if (stdMatch) {
    return { amount: Number(stdMatch.amount), source: 'standard', source_row_id: stdMatch.id };
  }
  return null;
}

// ── getSalesForPayWeek ───────────────────────────────────────────────────────

/**
 * Returns every sale that participates in the given pay_week's payfile.
 * Includes chargebacks (they net against payables); excludes rows held for
 * a future week (PAYABLE_NEXT_WEEK), cancelled rows, and unmapped rows
 * still in VERIFY.
 */
export async function getSalesForPayWeek(payWeek: string): Promise<PayrollSale[]> {
  const includedStatuses: SaleStatus[] = ['PAYABLE', 'WINBACK', 'CHARGEBACK'];
  const { data, error } = await supabase
    .from('payroll_sales')
    .select('*')
    .eq('pay_week', payWeek)
    .in('status', includedStatuses)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`getSalesForPayWeek: ${error.message}`);
  return (data ?? []) as PayrollSale[];
}

// ── validateSalesForPayWeek ──────────────────────────────────────────────────

export type ValidationCode =
  | 'VERIFY_PENDING'
  | 'NO_INTERNAL_AGENT'
  | 'NO_TIER'
  | 'NO_TERM'
  | 'NO_RATE'
  | 'OPEN_BADGE_ALERT';

export interface ValidationIssue {
  code: ValidationCode;
  level: 'critical' | 'warning';
  count: number;
  sample_sale_ids: string[];
  detail: string;
}

export interface ValidationResult {
  ok: boolean;
  pay_week: string;
  total_sales: number;
  issues: ValidationIssue[];
}

const SAMPLE_LIMIT = 5;

export async function validateSalesForPayWeek(payWeek: string): Promise<ValidationResult> {
  // We need VERIFY rows too for the pending check — they don't pass the
  // pay_week filter on their own (their pay_week is NULL until they
  // resolve), so we look them up by upload via a join. For simplicity we
  // just look at every sale with the same pay_week OR upload.pay_week.
  // For block 05 we keep it tight: VERIFY rows are flagged elsewhere
  // (Plan Mapping tab) and validateSalesForPayWeek only checks rows that
  // already have pay_week assigned.
  const sales = await getSalesForPayWeek(payWeek);

  // VERIFY rows have NULL pay_week, so we ALSO load any VERIFY rows whose
  // owning upload targets this pay_week — those will block publication.
  const { data: verifyRows } = await supabase
    .from('payroll_sales')
    .select('id, plan_name, upload_id, payroll_uploads!inner(pay_week, deleted_at)')
    .eq('status', 'VERIFY')
    .eq('payroll_uploads.pay_week', payWeek)
    .is('payroll_uploads.deleted_at', null);

  const issues: ValidationIssue[] = [];

  // ── 1. Unresolved VERIFY rows tied to this pay_week ──────────────────────
  if ((verifyRows ?? []).length > 0) {
    const rows = verifyRows ?? [];
    const plans = Array.from(new Set(rows.map((r) => (r as { plan_name: string }).plan_name)));
    issues.push({
      code: 'VERIFY_PENDING',
      level: 'critical',
      count: rows.length,
      sample_sale_ids: rows.slice(0, SAMPLE_LIMIT).map((r) => (r as { id: string }).id),
      detail: `Ventas en VERIFY: ${plans.slice(0, 3).join(', ')}${plans.length > 3 ? '…' : ''}`,
    });
  }

  // ── 2. internal_agent_id NULL ────────────────────────────────────────────
  const noAgent = sales.filter((s) => !s.internal_agent_id);
  if (noAgent.length > 0) {
    issues.push({
      code: 'NO_INTERNAL_AGENT',
      level: 'critical',
      count: noAgent.length,
      sample_sale_ids: noAgent.slice(0, SAMPLE_LIMIT).map((s) => s.id),
      detail: `Badges JE sin asociar a un usuario: ${Array.from(new Set(noAgent.map((s) => s.je_badge))).slice(0, 3).join(', ')}…`,
    });
  }

  // ── 3. D2D COMMISSION sales missing tier or term ─────────────────────────
  const mappingIds = Array.from(
    new Set(sales.map((s) => s.plan_mapping_id).filter((id): id is string => !!id)),
  );
  let mappingById = new Map<string, PlanMapping>();
  if (mappingIds.length > 0) {
    const { data: mappings } = await supabase
      .from('plan_mappings')
      .select('*')
      .in('id', mappingIds);
    mappingById = new Map((mappings ?? []).map((m) => [m.id, m as PlanMapping]));
  }

  const d2dCommissionSales = sales.filter((s) => {
    if (!s.plan_mapping_id) return false;
    const m = mappingById.get(s.plan_mapping_id);
    return m?.campaign === 'D2D' && m.plan_type === 'COMMISSION';
  });

  const noTier = d2dCommissionSales.filter((s) => s.assigned_tier === null);
  if (noTier.length > 0) {
    issues.push({
      code: 'NO_TIER',
      level: 'critical',
      count: noTier.length,
      sample_sale_ids: noTier.slice(0, SAMPLE_LIMIT).map((s) => s.id),
      detail: 'Ventas D2D COMMISSION sin tier — admin debe tier-taggear el plan_mapping.',
    });
  }

  const noTerm = d2dCommissionSales.filter((s) => s.assigned_term_months === null);
  if (noTerm.length > 0) {
    issues.push({
      code: 'NO_TERM',
      level: 'critical',
      count: noTerm.length,
      sample_sale_ids: noTerm.slice(0, SAMPLE_LIMIT).map((s) => s.id),
      detail: 'Ventas D2D COMMISSION sin term — falta en plan_mapping y en raw_term_months.',
    });
  }

  // ── 4. Rate coverage: each distinct combo must resolve to a standard rate.
  // Cheap proxy that catches the "we forgot to seed a rate" gap. Custom
  // rate gaps are not checked here — they'd be per-user and per-status,
  // and the worst case is a clear error at calc time.
  const combos = new Set<string>();
  for (const s of d2dCommissionSales) {
    if (s.status !== 'PAYABLE' && s.status !== 'WINBACK') continue;
    if (s.assigned_tier === null || s.assigned_term_months === null) continue;
    combos.add(`D2D|${s.assigned_tier}|${s.assigned_term_months}`);
  }
  const retailCommissionSales = sales.filter((s) => {
    if (!s.plan_mapping_id) return false;
    const m = mappingById.get(s.plan_mapping_id);
    return m?.campaign === 'RETAIL' && m.plan_type === 'COMMISSION'
        && (s.status === 'PAYABLE' || s.status === 'WINBACK');
  });
  if (retailCommissionSales.length > 0) combos.add('RETAIL||');

  const missingRates: string[] = [];
  for (const key of combos) {
    const [campaign, tierStr, termStr] = key.split('|');
    const rate = await resolveApplicableRate({
      user_id: null, // standard only
      campaign: campaign as RosterCampaign,
      tier: tierStr ? Number(tierStr) : null,
      term_months: termStr ? Number(termStr) : null,
      position: 'agent',
      manager_level: null,
      rate_type: 'COMMISSION',
      pay_week: payWeek,
    });
    if (!rate) missingRates.push(key);
  }
  if (missingRates.length > 0) {
    const affected = sales.filter((s) => {
      const m = s.plan_mapping_id ? mappingById.get(s.plan_mapping_id) : null;
      if (!m) return false;
      const key = m.campaign === 'D2D'
        ? `D2D|${s.assigned_tier}|${s.assigned_term_months}`
        : 'RETAIL||';
      return missingRates.includes(key);
    });
    issues.push({
      code: 'NO_RATE',
      level: 'critical',
      count: affected.length,
      sample_sale_ids: affected.slice(0, SAMPLE_LIMIT).map((s) => s.id),
      detail: `Combinaciones sin tarifa estándar: ${missingRates.join('; ')}`,
    });
  }

  // ── 5. Open badge alerts that touch this week's sales ────────────────────
  if (sales.length > 0) {
    const badges = Array.from(new Set(sales.map((s) => s.je_badge)));
    const { data: alerts } = await supabase
      .from('je_badge_alerts')
      .select('je_badge')
      .is('resolved_at', null)
      .in('je_badge', badges);
    const openBadges = new Set((alerts ?? []).map((a) => a.je_badge));
    const affected = sales.filter((s) => openBadges.has(s.je_badge));
    if (affected.length > 0) {
      issues.push({
        code: 'OPEN_BADGE_ALERT',
        level: 'warning',
        count: affected.length,
        sample_sale_ids: affected.slice(0, SAMPLE_LIMIT).map((s) => s.id),
        detail: `Badges JE sin resolver: ${Array.from(openBadges).slice(0, 3).join(', ')}…`,
      });
    }
  }

  const criticalCount = issues.filter((i) => i.level === 'critical').length;
  return {
    ok: criticalCount === 0,
    pay_week: payWeek,
    total_sales: sales.length,
    issues,
  };
}
