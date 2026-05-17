/**
 * Block 06 — Commission + override calculation orchestrator.
 * ============================================================================
 *
 * Reads all PAYABLE / WINBACK / CHARGEBACK sales for a pay_week and writes
 * a fresh set of payfile_line_items + payfile_overrides per affected user.
 *
 * Idempotent: a second call with no input changes produces the same output
 * and never duplicates rows. Manual edits and manually-added rows survive
 * the recalc — only auto-generated rows are wiped before reinsert.
 *
 * Concepts:
 *   - "Personal sale" — a manager appears as the seller (via their
 *     roster badge for that campaign). They get a single COMMISSION line
 *     item whose amount sums the agent commission + their own
 *     OVERRIDE_DIRECT. Managers above them still get override lines as
 *     usual.
 *   - "Hierarchy override" — every level above the seller, slotted by
 *     position. Closest non-null = DIRECT, everyone above = INDIRECT.
 *   - "Chargeback" — negative line item / negative override. Amount is
 *     looked up from history (the exact prior pay) so a mid-cycle rate
 *     change doesn't change what we claw back. Falls back to current
 *     rate when no historical row is found.
 *   - "Inactive-on-chargeback" — when an inactive user takes a
 *     chargeback, we route to negative_balances instead of dragging a
 *     payfile total below zero.
 *
 * Server-side only.
 */

import { supabase } from '@/lib/supabase';
import { validateSalesForPayWeek, getSalesForPayWeek, resolveApplicableRate } from '@/lib/payroll/rates';
import { findHistoricalCommission, findHistoricalOverride } from '@/lib/payroll/chargebackHistory';
import {
  resolveManagerHierarchy,
  isDirectOverride,
  rosterIndexKey,
  type RosterIndex,
  type RosterRow,
  type HierarchySlot,
} from '@/lib/payroll/managerHierarchy';
import { resolveTierForSale, resolveTermMonthsForSale } from '@/lib/payroll/tierResolution';
import {
  wipeAutoNegativeBalanceRowsForPayfile,
  applyPendingBalancesToPayfile,
  finalizePayfileIfNegative,
} from '@/lib/payroll/negativeBalances';
import {
  wipeAutoCollectionRowsForPayfile,
  applyCollectionInstallmentsToDebtor,
  creditBeneficiaries,
  type PendingCredit,
} from '@/lib/payroll/collections';
import type {
  PayrollSale, PlanMapping, Payfile, PayfileLineItem,
} from '@/types/payroll';
import type {
  RosterCampaign, RosterPosition, ManagerLevel, PayfileLineType,
} from '@/lib/payroll/constants';
import { OVER_RECEIVED_MULTIPLE } from '@/lib/payroll/constants';

// ── Public surface ──────────────────────────────────────────────────────────

export interface CalculationError {
  code: string;
  message: string;
  sale_id?: string;
  user_id?: string;
}

export interface CalculationResult {
  ok: boolean;
  pay_week: string;
  payfiles_generated: number;
  total_line_items: number;
  total_overrides: number;
  /** Inactive-user chargebacks routed to negative_balances (from block 06). */
  negative_balances_created: number;
  /** Block 08: NEGATIVE_BALANCE_COLLECTION line items inserted in this run. */
  carry_over_lines_created: number;
  /** Block 08: payfiles whose final total was forced to 0 (residual rolled). */
  negative_payfiles: number;
  /** Block 09: COLLECTION deduction line items (debtor side). */
  collection_lines_created: number;
  /** Block 09: COLLECTION_INCOME credits applied to beneficiaries. */
  collection_credits_applied: number;
  /** Block 09: CEO beneficiary records routed to company_bonuses. */
  ceo_collection_credits: number;
  errors: CalculationError[];
}

export async function calculatePayrollForWeek(payWeek: string): Promise<CalculationResult> {
  // ── 1. Refuse if validation hasn't cleared. ────────────────────────────────
  const validation = await validateSalesForPayWeek(payWeek);
  if (!validation.ok) {
    return {
      ok: false,
      pay_week: payWeek,
      payfiles_generated: 0,
      total_line_items: 0,
      total_overrides: 0,
      negative_balances_created: 0,
      carry_over_lines_created: 0,
      negative_payfiles: 0,
      collection_lines_created: 0,
      collection_credits_applied: 0,
      ceo_collection_credits: 0,
      errors: validation.issues
        .filter((i) => i.level === 'critical')
        .map((i) => ({ code: i.code, message: i.detail })),
    };
  }

  // ── 2. Pre-fetch everything the calc needs (one query each). ──────────────
  const ctx = await buildCalcContext(payWeek);

  // ── 3. Per-user accumulators. ─────────────────────────────────────────────
  const linesPerUser = new Map<string, PendingLineItem[]>();
  const overridesPerUser = new Map<string, PendingOverride[]>();
  const negativeBalances: PendingNegativeBalance[] = [];
  const errors: CalculationError[] = [];

  // ── 4. Walk each sale. ────────────────────────────────────────────────────
  for (const sale of ctx.sales) {
    try {
      await processSale(sale, ctx, linesPerUser, overridesPerUser, negativeBalances);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ code: 'PROCESS_FAILED', message: msg, sale_id: sale.id });
    }
  }

  // ── 5. Write to DB: upsert payfiles, wipe auto rows, insert fresh, ────────
  //       apply block-08 carry-over, finalize negative case.
  //
  // We also touch users that have *pending balances even without sales this
  // week*, so a user with only carry-over to collect still gets a payfile.
  const affectedUsers = new Set<string>([
    ...linesPerUser.keys(),
    ...overridesPerUser.keys(),
  ]);
  const carryOverOnlyUsers = await usersWithOpenBalances(affectedUsers);
  for (const u of carryOverOnlyUsers) affectedUsers.add(u);

  let totalLines = 0;
  let totalOverrides = 0;
  let carryOverLines = 0;
  let negativePayfiles = 0;
  let collectionLines = 0;

  // Block 09: pending beneficiary credits buffered across the main loop,
  // applied in a second pass before finalize-if-negative.
  const beneficiaryCredits: PendingCredit[] = [];
  // Map of payfileId → running total before finalize. Block 09 may bump
  // beneficiary totals after the first-pass apply; we finalize once at the
  // end with the right number.
  const runningTotals = new Map<string, number>();
  const payfileByUser = new Map<string, string>();

  for (const userId of affectedUsers) {
    const payfile = await upsertPayfile(userId, payWeek);
    payfileByUser.set(userId, payfile.id);

    // ── 5a. Wipe auto rows from any previous calc on this payfile. ─────────
    await wipeAutoRows(payfile.id, payWeek, userId);
    // Block 08: revert collected_amount on linked balances + delete
    // auto-generated balances tied to this payfile (residual rolls). MUST
    // happen before the new carry-over apply step below.
    await wipeAutoNegativeBalanceRowsForPayfile(payfile.id);
    // Block 09: revert collected_amount on linked collection installments +
    // delete auto COLLECTION line items.
    await wipeAutoCollectionRowsForPayfile(payfile.id);

    // ── 5b. Insert fresh auto line items and override rows. ────────────────
    const lines = linesPerUser.get(userId) ?? [];
    if (lines.length > 0) {
      const inserted = await insertLineItems(payfile.id, lines);
      totalLines += inserted;
    }
    const overrides = overridesPerUser.get(userId) ?? [];
    for (const ov of overrides) {
      const li = await insertOverrideLineItem(payfile.id, ov);
      await insertOverrideRow(ov, li.id);
      totalOverrides += 1;
    }

    // ── 5c. Compute running total before carry-over. ───────────────────────
    const runningBefore = await sumLineItemAmounts(payfile.id);

    // ── 5d. Apply pending negative balances oldest-first. ──────────────────
    const apply = await applyPendingBalancesToPayfile(userId, payfile.id, runningBefore);
    carryOverLines += apply.linesCreated;

    // ── 5e. Apply pending collection installments (debtor side). ───────────
    const coll = await applyCollectionInstallmentsToDebtor(
      userId, payfile.id, payWeek, apply.totalAfterCollection,
    );
    collectionLines += coll.linesCreated;
    if (coll.credits.length > 0) beneficiaryCredits.push(...coll.credits);

    // Defer finalize to after the beneficiary-credit pass — credits could
    // bump THIS user's running total if they're also a beneficiary of
    // somebody else's collection.
    runningTotals.set(payfile.id, coll.totalAfterCollections);
  }

  // ── 6. Beneficiary credit pass. Adds COLLECTION_INCOME lines to each
  //       beneficiary's payfile, or routes CEO credits to company_bonuses.
  const creditResult = await creditBeneficiaries(beneficiaryCredits);
  // Beneficiary payfiles that got fresh credits need a recomputed total
  // before finalize.
  for (const pfId of creditResult.payfilesTouched) {
    runningTotals.set(pfId, await sumLineItemAmounts(pfId));
  }

  // ── 7. Finalize per affected payfile (negative → new balance + total=0). ──
  // Build the union of payfiles that need finalize: every user in the main
  // loop + every beneficiary payfile that was touched in the credit pass.
  const allPayfileIds = new Set<string>([
    ...payfileByUser.values(),
    ...creditResult.payfilesTouched,
  ]);
  let totalPayfilesGenerated = 0;
  for (const payfileId of allPayfileIds) {
    // Find owning user_id + running total.
    const { data: pf } = await supabase
      .from('payfiles')
      .select('user_id')
      .eq('id', payfileId)
      .single();
    if (!pf) continue;
    const userId = (pf as { user_id: string }).user_id;
    const running = runningTotals.has(payfileId)
      ? runningTotals.get(payfileId)!
      : await sumLineItemAmounts(payfileId);
    const finalize = await finalizePayfileIfNegative(payfileId, userId, payWeek, running);
    if (finalize.hadNegativeBalance) negativePayfiles += 1;
    totalPayfilesGenerated += 1;
  }

  // ── 6. Persist inactive-user chargebacks routed to negative_balances. ─────
  let negCreated = 0;
  for (const nb of negativeBalances) {
    const ok = await insertNegativeBalance(nb);
    if (ok) negCreated += 1;
  }

  return {
    ok: errors.length === 0,
    pay_week: payWeek,
    payfiles_generated: totalPayfilesGenerated,
    total_line_items: totalLines,
    total_overrides: totalOverrides,
    negative_balances_created: negCreated,
    carry_over_lines_created: carryOverLines,
    negative_payfiles: negativePayfiles,
    collection_lines_created: collectionLines,
    collection_credits_applied: creditResult.lineItemsCreated,
    ceo_collection_credits: creditResult.ceoRecords,
    errors,
  };
}

/**
 * Block 08 — find users who have open negative_balances but no sales this
 * week. They still need a payfile so the carry-over can chip away at the
 * debt when they have residual / collection income (rare today, but the
 * orchestrator should handle it consistently).
 */
async function usersWithOpenBalances(exclude: Set<string>): Promise<string[]> {
  const { data } = await supabase
    .from('negative_balances')
    .select('user_id')
    .in('status', ['PENDING', 'PARTIALLY_COLLECTED']);
  const ids = new Set<string>();
  for (const r of (data ?? []) as Array<{ user_id: string }>) {
    if (!exclude.has(r.user_id)) ids.add(r.user_id);
  }
  return Array.from(ids);
}

async function sumLineItemAmounts(payfileId: string): Promise<number> {
  const { data } = await supabase
    .from('payfile_line_items')
    .select('amount')
    .eq('payfile_id', payfileId);
  return (data ?? []).reduce((acc, r) => acc + Number(r.amount), 0);
}

// ── Context (cache layer) ───────────────────────────────────────────────────

interface CalcContext {
  payWeek: string;
  sales: PayrollSale[];
  mappingById: Map<string, PlanMapping>;
  rosterIndex: RosterIndex;
  users: Map<string, { id: string; name: string; role: string; payroll_status: 'active' | 'inactive' }>;
}

async function buildCalcContext(payWeek: string): Promise<CalcContext> {
  const sales = await getSalesForPayWeek(payWeek);

  // Plan mappings referenced by these sales.
  const mappingIds = Array.from(
    new Set(sales.map((s) => s.plan_mapping_id).filter((id): id is string => !!id)),
  );
  const { data: mappings } = mappingIds.length
    ? await supabase.from('plan_mappings').select('*').in('id', mappingIds)
    : { data: [] };
  const mappingById = new Map(
    (mappings ?? []).map((m) => [m.id as string, m as PlanMapping]),
  );

  // Active roster vigent at payWeek. One query covers every campaign;
  // resolveManagerHierarchy filters in memory.
  const { data: roster } = await supabase
    .from('payroll_roster')
    .select('user_id, direct_manager_id, campaign, position, je_badge_status, valid_from, valid_until')
    .eq('je_badge_status', 'active')
    .lte('valid_from', payWeek)
    .or(`valid_until.is.null,valid_until.gte.${payWeek}`);

  const rosterIndex: RosterIndex = new Map();
  for (const r of (roster ?? []) as RosterRow[]) {
    rosterIndex.set(rosterIndexKey(r.user_id, r.campaign), r);
  }

  // Users referenced as agents OR as managers in the roster chain. We
  // over-fetch slightly (everyone in the roster) so the per-sale walks
  // never miss.
  const agentIds = sales.map((s) => s.internal_agent_id).filter((id): id is string => !!id);
  const rosterUserIds = (roster ?? []).map((r) => r.user_id);
  const managerIds = (roster ?? [])
    .map((r) => r.direct_manager_id)
    .filter((id): id is string => !!id);
  const userIdSet = new Set([...agentIds, ...rosterUserIds, ...managerIds]);

  const userIds = Array.from(userIdSet);
  const { data: usersData } = userIds.length
    ? await supabase
        .from('users')
        .select('id, name, role, payroll_status')
        .in('id', userIds)
    : { data: [] };
  const users = new Map(
    (usersData ?? []).map((u) => [u.id as string, u as { id: string; name: string; role: string; payroll_status: 'active' | 'inactive' }]),
  );

  return { payWeek, sales, mappingById, rosterIndex, users };
}

// ── Per-sale processing ─────────────────────────────────────────────────────

interface PendingLineItem {
  line_type: PayfileLineType;
  description: string;
  source_sale_id: string;
  amount: number;
  original_amount: number;
}

interface PendingOverride {
  manager_user_id: string;
  sale_id: string;
  manager_level: ManagerLevel;
  amount: number;
  original_amount: number;
  description: string;
}

interface PendingNegativeBalance {
  user_id: string;
  origin: 'COMMISSION' | 'OVERRIDE';
  source_sale_id: string;
  amount: number;
  origin_week: string;
  description: string;
  campaign: RosterCampaign;
  manager_at_time: string | null;
}

async function processSale(
  sale: PayrollSale,
  ctx: CalcContext,
  linesPerUser: Map<string, PendingLineItem[]>,
  overridesPerUser: Map<string, PendingOverride[]>,
  negativeBalances: PendingNegativeBalance[],
): Promise<void> {
  const agentId = sale.internal_agent_id;
  if (!agentId) return; // validateSalesForPayWeek already flagged this

  const mapping = sale.plan_mapping_id ? ctx.mappingById.get(sale.plan_mapping_id) : null;
  if (!mapping) return;

  // Adders / residuals / manual bonuses are handled by block 04's
  // company_bonuses + residuals paths. Skip them here.
  if (mapping.plan_type !== 'COMMISSION') return;

  const campaign = (mapping.campaign === 'BOTH' ? null : mapping.campaign) as RosterCampaign | null;
  if (!campaign) return; // BOTH-campaign plans shouldn't carry through here

  const agentBadge = ctx.rosterIndex.get(rosterIndexKey(agentId, campaign));
  const agentPositionForCampaign: RosterPosition =
    (agentBadge?.position as RosterPosition | undefined) ??
    ((ctx.users.get(agentId)?.role ?? 'agent') as RosterPosition);
  const sellerIsManager =
    agentPositionForCampaign === 'jr_manager' || agentPositionForCampaign === 'sr_manager';

  const agentUser = ctx.users.get(agentId);
  const agentInactive = agentUser?.payroll_status === 'inactive';

  // ── Seller's line: COMMISSION (PAYABLE/WINBACK) or chargeback line ───────
  if (sale.status === 'CHARGEBACK') {
    const historical = await findHistoricalCommission(sale);
    const baseAmount = historical ?? (
      (await resolveApplicableRate({
        user_id: agentId,
        campaign,
        tier: sale.assigned_tier,
        term_months: sale.assigned_term_months,
        position: 'agent',
        manager_level: null,
        rate_type: 'COMMISSION',
        pay_week: ctx.payWeek,
      }))?.amount ?? 0
    );

    if (baseAmount === 0) return; // nothing to charge back

    if (agentInactive) {
      negativeBalances.push({
        user_id: agentId,
        origin: 'COMMISSION',
        source_sale_id: sale.id,
        amount: baseAmount,
        origin_week: ctx.payWeek,
        description: `Chargeback (agente inactivo) – ${sale.plan_name} – ${sale.contract_id}`,
        campaign,
        manager_at_time: null,
      });
    } else {
      pushLine(linesPerUser, agentId, {
        line_type: 'COMMISSION',
        description: `Chargeback – ${sale.plan_name} – ${sale.contract_id}${sale.customer_name ? ' – ' + sale.customer_name : ''}`,
        source_sale_id: sale.id,
        amount: -baseAmount,
        original_amount: -baseAmount,
      });
    }
  } else {
    // PAYABLE or WINBACK
    const commissionRate = await resolveApplicableRate({
      user_id: agentId,
      campaign,
      tier: sale.assigned_tier,
      term_months: sale.assigned_term_months,
      position: 'agent',
      manager_level: null,
      rate_type: 'COMMISSION',
      pay_week: ctx.payWeek,
    });
    const commissionAmount = commissionRate?.amount ?? 0;

    if (sellerIsManager) {
      // Personal sale: merge the agent commission with the manager's own
      // OVERRIDE_DIRECT into a single COMMISSION line item. NO separate
      // payfile_overrides row for the self-override.
      const ownLevel: ManagerLevel = agentPositionForCampaign === 'sr_manager' ? 'MANAGER_1' : 'MANAGER_2';
      const selfOverride = await resolveApplicableRate({
        user_id: agentId,
        campaign,
        tier: sale.assigned_tier,
        term_months: sale.assigned_term_months,
        position: agentPositionForCampaign,
        manager_level: ownLevel,
        rate_type: 'OVERRIDE_DIRECT',
        pay_week: ctx.payWeek,
      });
      const total = commissionAmount + (selfOverride?.amount ?? 0);
      if (total !== 0) {
        pushLine(linesPerUser, agentId, {
          line_type: 'COMMISSION',
          description: `Comisión personal + override – ${sale.plan_name} – ${sale.contract_id}`,
          source_sale_id: sale.id,
          amount: total,
          original_amount: total,
        });
      }
    } else if (commissionAmount !== 0) {
      pushLine(linesPerUser, agentId, {
        line_type: 'COMMISSION',
        description: `Comisión – ${sale.plan_name} – ${sale.contract_id}${sale.customer_name ? ' – ' + sale.customer_name : ''}`,
        source_sale_id: sale.id,
        amount: commissionAmount,
        original_amount: commissionAmount,
      });
    }
  }

  // ── Overrides for hierarchy ──────────────────────────────────────────────
  const hierarchy = resolveManagerHierarchy(agentId, campaign, ctx.rosterIndex);

  for (const level of ['MANAGER_3', 'MANAGER_2', 'MANAGER_1'] as ManagerLevel[]) {
    const slot: HierarchySlot | null =
      level === 'MANAGER_1' ? hierarchy.manager_1 :
      level === 'MANAGER_2' ? hierarchy.manager_2 :
      hierarchy.manager_3;
    if (!slot) continue;

    // Don't double-pay a manager who's also the seller — their own override
    // was already merged into their COMMISSION line above.
    if (slot.user_id === agentId) continue;

    const direct = isDirectOverride(hierarchy, level);
    const rateType = direct ? 'OVERRIDE_DIRECT' : 'OVERRIDE_INDIRECT';

    const rate = await resolveApplicableRate({
      user_id: slot.user_id,
      campaign,
      tier: sale.assigned_tier,
      term_months: sale.assigned_term_months,
      position: slot.position,
      manager_level: level,
      rate_type: rateType,
      pay_week: ctx.payWeek,
    });
    const baseRate = rate?.amount ?? 0;
    if (baseRate === 0) continue;

    let amount = baseRate;
    if (sale.status === 'CHARGEBACK') {
      const historical = await findHistoricalOverride(sale, slot.user_id);
      amount = -(historical ?? baseRate);
    }

    const mgrUser = ctx.users.get(slot.user_id);
    const mgrInactive = mgrUser?.payroll_status === 'inactive';

    if (sale.status === 'CHARGEBACK' && mgrInactive) {
      negativeBalances.push({
        user_id: slot.user_id,
        origin: 'OVERRIDE',
        source_sale_id: sale.id,
        amount: Math.abs(amount),
        origin_week: ctx.payWeek,
        description: `Override chargeback (manager inactivo) – ${sale.plan_name} – ${sale.contract_id}`,
        campaign,
        manager_at_time: slot.user_id,
      });
      continue;
    }

    pushOverride(overridesPerUser, slot.user_id, {
      manager_user_id: slot.user_id,
      sale_id: sale.id,
      manager_level: level,
      amount,
      original_amount: amount,
      description: `Override ${direct ? 'directo' : 'indirecto'} – ${sale.plan_name} – ${sale.contract_id}`,
    });
  }
}

// ── DB writers ──────────────────────────────────────────────────────────────

async function upsertPayfile(userId: string, payWeek: string): Promise<Payfile> {
  // Try to find existing first; the (user_id, pay_week) unique constraint
  // makes a select-or-insert pattern race-safe in practice (this runs
  // single-threaded per calc).
  const { data: existing } = await supabase
    .from('payfiles')
    .select('*')
    .eq('user_id', userId)
    .eq('pay_week', payWeek)
    .maybeSingle();
  if (existing) return existing as Payfile;

  const { data, error } = await supabase
    .from('payfiles')
    .insert({ user_id: userId, pay_week: payWeek, state: 'DRAFT', total_amount: 0 })
    .select()
    .single();
  if (error || !data) throw new Error(`upsertPayfile: ${error?.message ?? 'no data'}`);
  return data as Payfile;
}

async function wipeAutoRows(payfileId: string, payWeek: string, userId: string): Promise<void> {
  // Delete auto-generated line items only. Manual edits, manual additions,
  // and externally-driven lines are preserved:
  //   - NEGATIVE_BALANCE_COLLECTION (block 08) → owned by its helper that
  //     reverts the linked balance first.
  //   - COLLECTION (block 09) → owned by its helper that reverts the
  //     linked installment first.
  //   - COMPANY_BONUS rows with source_bonus_distribution_id (block 10) →
  //     admin-distributed bonuses; their lifecycle is the distribution
  //     row, not the per-week calc.
  await supabase
    .from('payfile_line_items')
    .delete()
    .eq('payfile_id', payfileId)
    .eq('is_manually_edited', false)
    .eq('is_manually_added', false)
    .not('line_type', 'in', '(NEGATIVE_BALANCE_COLLECTION,COLLECTION)')
    .or('line_type.neq.COMPANY_BONUS,source_bonus_distribution_id.is.null');

  // Delete auto-generated override rows for sales in this week where the
  // user is the receiving manager.
  const { data: thisWeeksSales } = await supabase
    .from('payroll_sales')
    .select('id')
    .eq('pay_week', payWeek);
  const saleIds = (thisWeeksSales ?? []).map((s) => s.id);
  if (saleIds.length > 0) {
    await supabase
      .from('payfile_overrides')
      .delete()
      .eq('manager_id', userId)
      .in('sale_id', saleIds)
      .eq('is_manually_added', false);
  }
}

async function insertLineItems(payfileId: string, lines: PendingLineItem[]): Promise<number> {
  const rows = lines.map((l) => ({
    payfile_id: payfileId,
    line_type: l.line_type,
    description: l.description,
    source_sale_id: l.source_sale_id,
    amount: l.amount,
    original_amount: l.original_amount,
  }));
  const { error } = await supabase.from('payfile_line_items').insert(rows);
  if (error) throw new Error(`insertLineItems: ${error.message}`);
  return rows.length;
}

async function insertOverrideLineItem(
  payfileId: string,
  ov: PendingOverride,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('payfile_line_items')
    .insert({
      payfile_id: payfileId,
      line_type: 'OVERRIDE',
      description: ov.description,
      source_sale_id: ov.sale_id,
      amount: ov.amount,
      original_amount: ov.original_amount,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`insertOverrideLineItem: ${error?.message ?? 'no data'}`);
  return data as { id: string };
}

async function insertOverrideRow(ov: PendingOverride, lineItemId: string): Promise<void> {
  const { error } = await supabase
    .from('payfile_overrides')
    .insert({
      sale_id: ov.sale_id,
      manager_id: ov.manager_user_id,
      manager_level: ov.manager_level,
      amount: ov.amount,
      original_amount: ov.original_amount,
      payfile_line_item_id: lineItemId,
    });
  if (error) throw new Error(`insertOverrideRow: ${error.message}`);
}

async function insertNegativeBalance(nb: PendingNegativeBalance): Promise<boolean> {
  const { error } = await supabase
    .from('negative_balances')
    .insert({
      user_id: nb.user_id,
      origin: nb.origin,
      source_sale_id: nb.source_sale_id,
      original_amount: nb.amount,
      collected_amount: 0,
      remaining_amount: nb.amount,
      origin_week: nb.origin_week,
      description: nb.description,
      campaign: nb.campaign,
      manager_at_time: nb.manager_at_time,
      user_status_when_created: 'inactive',
      status: 'PENDING',
    });
  if (error) {
    console.error('[insertNegativeBalance] failed:', error);
    return false;
  }
  return true;
}

async function recomputeTotal(payfileId: string): Promise<void> {
  const { data } = await supabase
    .from('payfile_line_items')
    .select('amount')
    .eq('payfile_id', payfileId);
  const total = (data ?? []).reduce((acc, r) => acc + Number(r.amount), 0);
  await supabase.from('payfiles').update({ total_amount: total }).eq('id', payfileId);
}

// ── Tiny utils ──────────────────────────────────────────────────────────────

function pushLine(m: Map<string, PendingLineItem[]>, k: string, v: PendingLineItem) {
  const arr = m.get(k) ?? [];
  arr.push(v);
  m.set(k, arr);
}

function pushOverride(m: Map<string, PendingOverride[]>, k: string, v: PendingOverride) {
  const arr = m.get(k) ?? [];
  arr.push(v);
  m.set(k, arr);
}

// ── Editing single line items (block 6 §Edición manual) ─────────────────────

export interface EditLineItemArgs {
  line_item_id: string;
  new_amount: number;
  edit_note: string | null;
  editor_id: string;
  editor_role: string; // 'admin' | 'ceo' | ...
}

export interface EditLineItemResult {
  ok: boolean;
  line_item: PayfileLineItem | null;
  requires_ceo_approval: boolean;
  is_over_received_amount: boolean;
  is_over_3x_received: boolean;
  error?: string;
}

/**
 * Edit a line item's amount. Sets edit flags + the 3× guard + the
 * requires_ceo_approval flag when an admin pushes past 3× the JE
 * je_paid_amount. CEO edits never set requires_ceo_approval (their
 * approval is implicit), but the UI still shows the rule's warning.
 *
 * Audit log captures the before/after.
 */
export async function editLineItem(args: EditLineItemArgs): Promise<EditLineItemResult> {
  const { data: before } = await supabase
    .from('payfile_line_items')
    .select('*, payroll_sales!source_sale_id(je_paid_amount)')
    .eq('id', args.line_item_id)
    .maybeSingle();

  if (!before) return { ok: false, line_item: null, requires_ceo_approval: false, is_over_received_amount: false, is_over_3x_received: false, error: 'Line item no encontrado.' };

  // supabase-js returns the joined row as either object or single-item
  // array depending on the relation cardinality detection. Normalise.
  const rawSale = (before as { payroll_sales?: unknown }).payroll_sales;
  const sale = Array.isArray(rawSale)
    ? (rawSale[0] as { je_paid_amount?: number } | undefined)
    : (rawSale as { je_paid_amount?: number } | undefined);
  const jePaid = Math.abs(Number(sale?.je_paid_amount ?? 0));
  const absNew = Math.abs(args.new_amount);

  const isOverReceived = jePaid > 0 && absNew > jePaid;
  const isOver3x = jePaid > 0 && absNew > OVER_RECEIVED_MULTIPLE * jePaid;
  const requiresCeoApproval = isOver3x && args.editor_role !== 'ceo';

  const { data: updated, error } = await supabase
    .from('payfile_line_items')
    .update({
      amount: args.new_amount,
      is_manually_edited: true,
      is_over_received_amount: isOverReceived,
      is_over_3x_received: isOver3x,
      requires_ceo_approval: requiresCeoApproval,
      edit_note: args.edit_note || 'AJUSTE',
      edited_by: args.editor_id,
      edited_at: new Date().toISOString(),
    })
    .eq('id', args.line_item_id)
    .select()
    .single();

  if (error || !updated) return { ok: false, line_item: null, requires_ceo_approval: false, is_over_received_amount: false, is_over_3x_received: false, error: error?.message ?? 'update failed' };

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'payfile_line_item',
    entity_id: args.line_item_id,
    action: 'EDIT_AMOUNT',
    actor_id: args.editor_id,
    old_value: { amount: before.amount, is_manually_edited: before.is_manually_edited },
    new_value: { amount: args.new_amount, edit_note: args.edit_note },
    change_notes: requiresCeoApproval ? 'Excede 3× JE — requiere aprobación CEO' : null,
  });

  await recomputeTotal(updated.payfile_id);

  return {
    ok: true,
    line_item: updated as PayfileLineItem,
    requires_ceo_approval: requiresCeoApproval,
    is_over_received_amount: isOverReceived,
    is_over_3x_received: isOver3x,
  };
}

