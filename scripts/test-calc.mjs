#!/usr/bin/env node
/**
 * Block 06 dry-run: simulate the calculation logic for hand-built scenarios
 * and assert the expected line items + overrides. No DB. No fixture file
 * — these are synthetic cases that exercise each path in calculatePayfile
 * processSale().
 *
 * Mirrors the logic in src/lib/payroll/calculatePayfile.ts. If you change
 * a rule there, mirror it here.
 */

// Block-05 seed rates (truncated to what these scenarios need).
const STANDARD_RATES = [
  // D2D agent COMMISSION
  { campaign: 'D2D', tier: 0, term_months: 60, position: 'agent',      manager_level: null,        rate_type: 'COMMISSION',        amount:  50 },
  { campaign: 'D2D', tier: 3, term_months: 60, position: 'agent',      manager_level: null,        rate_type: 'COMMISSION',        amount: 170 },
  { campaign: 'D2D', tier: 3, term_months: 36, position: 'agent',      manager_level: null,        rate_type: 'COMMISSION',        amount: 160 },
  { campaign: 'D2D', tier: 0, term_months: 60, position: 'sr_manager', manager_level: 'MANAGER_1', rate_type: 'OVERRIDE_DIRECT',   amount:   5 },
  { campaign: 'D2D', tier: 3, term_months: 60, position: 'sr_manager', manager_level: 'MANAGER_1', rate_type: 'OVERRIDE_DIRECT',   amount:  55 },
  { campaign: 'D2D', tier: 3, term_months: 36, position: 'sr_manager', manager_level: 'MANAGER_1', rate_type: 'OVERRIDE_DIRECT',   amount:  55 },
  // Retail
  { campaign: 'RETAIL', tier: null, term_months: null, position: 'agent',      manager_level: null,        rate_type: 'COMMISSION',        amount: 100 },
  { campaign: 'RETAIL', tier: null, term_months: null, position: 'jr_manager', manager_level: 'MANAGER_2', rate_type: 'OVERRIDE_DIRECT',   amount:  20 },
  { campaign: 'RETAIL', tier: null, term_months: null, position: 'sr_manager', manager_level: 'MANAGER_1', rate_type: 'OVERRIDE_DIRECT',   amount:  40 },
  { campaign: 'RETAIL', tier: null, term_months: null, position: 'sr_manager', manager_level: 'MANAGER_1', rate_type: 'OVERRIDE_INDIRECT', amount:  20 },
];

function rate({ campaign, tier, term_months, position, manager_level, rate_type }) {
  const hit = STANDARD_RATES.find((r) =>
    r.campaign === campaign &&
    (r.tier ?? null) === (tier ?? null) &&
    (r.term_months ?? null) === (term_months ?? null) &&
    r.position === position &&
    (r.manager_level ?? null) === (manager_level ?? null) &&
    r.rate_type === rate_type,
  );
  return hit?.amount ?? null;
}

function slotFor(position) {
  return position === 'sr_manager' ? 'MANAGER_1'
       : position === 'jr_manager' ? 'MANAGER_2'
       : null;
}

function isDirect(hierarchy, level) {
  if (level === 'MANAGER_3') return hierarchy.manager_3 != null;
  if (level === 'MANAGER_2') return hierarchy.manager_2 != null && hierarchy.manager_3 == null;
  if (level === 'MANAGER_1') return hierarchy.manager_1 != null && hierarchy.manager_2 == null && hierarchy.manager_3 == null;
  return false;
}

function calcSale({ sale, roster, sellerPosition }) {
  const lineItems = []; // { user_id, line_type, amount, description }
  const overrides = []; // { manager_id, level, amount }

  const isManagerSale = sellerPosition === 'jr_manager' || sellerPosition === 'sr_manager';
  const isCb = sale.status === 'CHARGEBACK';

  // Commission/personal line for the seller
  if (isCb) {
    // Historical lookup (skipped in dry-run, use current rate)
    const baseRate = rate({
      campaign: sale.campaign, tier: sale.tier, term_months: sale.term,
      position: 'agent', manager_level: null, rate_type: 'COMMISSION',
    }) ?? 0;
    if (baseRate !== 0) {
      lineItems.push({ user_id: sale.agent, line_type: 'COMMISSION', amount: -baseRate, description: `Chargeback – ${sale.plan_name}` });
    }
  } else {
    const commissionRate = rate({
      campaign: sale.campaign, tier: sale.tier, term_months: sale.term,
      position: 'agent', manager_level: null, rate_type: 'COMMISSION',
    }) ?? 0;
    if (isManagerSale) {
      const ownLevel = slotFor(sellerPosition);
      const selfOverride = rate({
        campaign: sale.campaign, tier: sale.tier, term_months: sale.term,
        position: sellerPosition, manager_level: ownLevel, rate_type: 'OVERRIDE_DIRECT',
      }) ?? 0;
      const total = commissionRate + selfOverride;
      if (total !== 0) {
        lineItems.push({ user_id: sale.agent, line_type: 'COMMISSION', amount: total, description: 'Personal + own override' });
      }
    } else if (commissionRate !== 0) {
      lineItems.push({ user_id: sale.agent, line_type: 'COMMISSION', amount: commissionRate, description: `Comisión – ${sale.plan_name}` });
    }
  }

  // Hierarchy: synthetic, supplied per scenario as { manager_1, manager_2, manager_3 }
  const hierarchy = roster.hierarchy;
  for (const level of ['MANAGER_3', 'MANAGER_2', 'MANAGER_1']) {
    const slot = level === 'MANAGER_1' ? hierarchy.manager_1
              : level === 'MANAGER_2' ? hierarchy.manager_2
              : hierarchy.manager_3;
    if (!slot) continue;
    if (slot.user_id === sale.agent) continue; // already merged into personal line

    const direct = isDirect(hierarchy, level);
    const rateType = direct ? 'OVERRIDE_DIRECT' : 'OVERRIDE_INDIRECT';

    const baseRate = rate({
      campaign: sale.campaign, tier: sale.tier, term_months: sale.term,
      position: slot.position, manager_level: level, rate_type: rateType,
    }) ?? 0;
    if (baseRate === 0) continue;
    const amount = isCb ? -baseRate : baseRate;
    overrides.push({ manager_id: slot.user_id, level, rateType, amount });
    lineItems.push({ user_id: slot.user_id, line_type: 'OVERRIDE', amount, description: `Override ${direct ? 'directo' : 'indirecto'} – ${sale.plan_name}` });
  }

  return { lineItems, overrides };
}

function assert(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  const tag = ok ? '✓' : '✗';
  console.log(`${tag} ${label}`);
  if (!ok) {
    console.log('   expected:', JSON.stringify(expected));
    console.log('   actual  :', JSON.stringify(actual));
  }
  return ok;
}

let allPass = true;
function check(label, actual, expected) { allPass = assert(label, actual, expected) && allPass; }

// ── Scenario 1: D2D agent T0 60M PAYABLE ──────────────────────────────────
{
  const sale = { agent: 'A1', campaign: 'D2D', tier: 0, term: 60, status: 'PAYABLE', plan_name: 'D2D-T0-60' };
  const roster = { hierarchy: { manager_1: { user_id: 'M1', position: 'sr_manager' }, manager_2: null, manager_3: null } };
  const { lineItems } = calcSale({ sale, roster, sellerPosition: 'agent' });
  check('D2D agent T0 60M PAYABLE → A1 gets $50 commission', lineItems.filter((l) => l.user_id === 'A1').map((l) => l.amount), [50]);
  check('D2D agent T0 60M PAYABLE → M1 gets $5 OVERRIDE_DIRECT', lineItems.filter((l) => l.user_id === 'M1').map((l) => l.amount), [5]);
}

// ── Scenario 2: D2D agent T3 36M CHARGEBACK ───────────────────────────────
{
  const sale = { agent: 'A1', campaign: 'D2D', tier: 3, term: 36, status: 'CHARGEBACK', plan_name: 'D2D-T3-36-CB' };
  const roster = { hierarchy: { manager_1: { user_id: 'M1', position: 'sr_manager' }, manager_2: null, manager_3: null } };
  const { lineItems } = calcSale({ sale, roster, sellerPosition: 'agent' });
  check('D2D T3 36M CHARGEBACK → A1 gets -$160', lineItems.filter((l) => l.user_id === 'A1').map((l) => l.amount), [-160]);
  check('D2D T3 36M CHARGEBACK → M1 gets -$55', lineItems.filter((l) => l.user_id === 'M1').map((l) => l.amount), [-55]);
}

// ── Scenario 3: D2D Sr Manager personal sale T3 60M ───────────────────────
{
  const sale = { agent: 'M1', campaign: 'D2D', tier: 3, term: 60, status: 'PAYABLE', plan_name: 'D2D-T3-60' };
  const roster = { hierarchy: { manager_1: { user_id: 'M1', position: 'sr_manager' }, manager_2: null, manager_3: null } };
  const { lineItems, overrides } = calcSale({ sale, roster, sellerPosition: 'sr_manager' });
  check('Mgr1 personal D2D T3 60M → single COMMISSION line for $225', lineItems.filter((l) => l.user_id === 'M1').map((l) => ({ t: l.line_type, a: l.amount })), [{ t: 'COMMISSION', a: 225 }]);
  check('Mgr1 personal D2D → no separate override row', overrides, []);
}

// ── Scenario 4: Retail agent PAYABLE (M1+M2 hierarchy) ────────────────────
{
  const sale = { agent: 'A1', campaign: 'RETAIL', tier: null, term: null, status: 'PAYABLE', plan_name: 'Retail-Green' };
  const roster = { hierarchy: { manager_1: { user_id: 'S1', position: 'sr_manager' }, manager_2: { user_id: 'J1', position: 'jr_manager' }, manager_3: null } };
  const { lineItems } = calcSale({ sale, roster, sellerPosition: 'agent' });
  check('Retail agent → A1 gets $100 commission', lineItems.filter((l) => l.user_id === 'A1').map((l) => l.amount), [100]);
  check('Retail agent → J1 (M2) gets $20 OVERRIDE_DIRECT (closest)', lineItems.filter((l) => l.user_id === 'J1').map((l) => l.amount), [20]);
  check('Retail agent → S1 (M1) gets $20 OVERRIDE_INDIRECT (higher)', lineItems.filter((l) => l.user_id === 'S1').map((l) => l.amount), [20]);
}

// ── Scenario 5: Retail Jr Manager personal sale ───────────────────────────
{
  const sale = { agent: 'J1', campaign: 'RETAIL', tier: null, term: null, status: 'PAYABLE', plan_name: 'Retail-LMMM' };
  const roster = { hierarchy: { manager_1: { user_id: 'S1', position: 'sr_manager' }, manager_2: { user_id: 'J1', position: 'jr_manager' }, manager_3: null } };
  const { lineItems } = calcSale({ sale, roster, sellerPosition: 'jr_manager' });
  check('Retail Jr Manager personal → single COMMISSION line for $120 ($100 + $20)', lineItems.filter((l) => l.user_id === 'J1').map((l) => ({ t: l.line_type, a: l.amount })), [{ t: 'COMMISSION', a: 120 }]);
  check('Retail Jr Manager personal → S1 (M1) gets $20 INDIRECT override (still has Jr below)', lineItems.filter((l) => l.user_id === 'S1').map((l) => l.amount), [20]);
}

console.log(allPass ? '\n✓ all dry-run scenarios pass' : '\n✗ some scenarios failed');
process.exit(allPass ? 0 : 1);
