#!/usr/bin/env node
/**
 * Dry-run test of the parser logic against the fixture file. Skips DB calls
 * — just verifies the column resolution, row classification, dedup keying,
 * and amount/term/date parsing. The output should match a manual reading
 * of the source workbook.
 */
import ExcelJS from 'exceljs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Re-implement the small surface we need here (the TS module isn't importable
// from a plain .mjs without a build step). Logic mirrors uploadConfig.ts.

const COMMISSIONS_SHEET_NAME = 'Commissions';

const COLUMN_ALIASES = {
  contract_id: ['contract id', 'contract number', 'contract #', 'contractid'],
  customer_name: ['customer name', 'customer', 'account name'],
  plan_name: ['plan name', 'plan'],
  je_badge: ['agent badge number', 'agent badge', 'badge number', 'je badge', 'badge', 'rep id', 'agent id'],
  marketing_channel: ['marketing channel', 'channel', 'sales channel'],
  je_disposition: ['termination description', 'enrollment category', 'qualifying status', 'disposition', 'je disposition', 'commission disposition'],
  contract_signed_date: ['contract signed date', 'signed date', 'sign date', 'contract date', 'signature date', 'enrollment date'],
  kwh_or_rce: ['ldc contracted usage', 'commission usage', 'ldc annual usage', 'rce', 'kwh', 'annual rce', 'annual kwh'],
  commission_type: ['commission type', 'comm type'],
  je_paid_amount: ['total', 'amount', 'commission amount', 'commission'],
  term: ['contract term (months)', 'contract term', 'term months', 'term', 'contract length'],
  notes: ['notes', 'note', 'comment'],
};

const normalize = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const isManualBonusRow = (ct) => (ct ?? '').trim().toLowerCase() === 'manual';
const isChargebackRow = (total, ct) => {
  if (total !== null && total < 0) return true;
  return (ct ?? '').trim().toLowerCase() === 'correction';
};

function readNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[$,\s]/g, '').replace(/[()]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function readInt(v) {
  const n = readNumber(v);
  if (n == null) return null;
  return Math.round(n);
}

function readDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    const ms = (v - 25569) * 86400 * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const d = new Date(String(v));
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function readString(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('text' in v) return String(v.text).trim();
    if ('result' in v) return String(v.result ?? '').trim();
    if (v instanceof Date) return v.toISOString();
  }
  return String(v).trim();
}

const fixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../docs/payroll/samples/27155_Watts_Distributors_LLC_US_Weekly_1524_FlatFee_May102026.xlsx',
);

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(fixture);
const sheet = wb.getWorksheet(COMMISSIONS_SHEET_NAME);
if (!sheet) throw new Error('No Commissions sheet');

// Build header index from row 1
const present = new Map();
sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
  const n = normalize(cell.value);
  if (n && !present.has(n)) present.set(n, col);
});
const idx = new Map();
for (const [logical, aliases] of Object.entries(COLUMN_ALIASES)) {
  for (const a of aliases) {
    const col = present.get(normalize(a));
    if (col) { idx.set(logical, col); break; }
  }
}

console.log('━━━ Header resolution ━━━');
for (const k of Object.keys(COLUMN_ALIASES)) {
  const col = idx.get(k);
  const realHeader = col ? sheet.getRow(1).getCell(col).value : '—';
  console.log(`  ${k.padEnd(22)} → col ${col ?? '—'}  (${realHeader})`);
}

// Hard-coded plan mappings from the block-03 seed migration. Used here only
// to classify rows the same way the runtime parser would.
const SEEDED_MAPPINGS = new Map([
  ['Watts - Texas - ELE - D2D - 60 - 0.40-0.59 RCE - $95',  { plan_type: 'COMMISSION', campaign: 'D2D' }],
  ['Watts - Texas - ELE - D2D - 60 - 0.60-0.69 RCE - $170', { plan_type: 'COMMISSION', campaign: 'D2D' }],
  ['Watts - Texas - ELE - D2D - 60 - 0.7 - 1.19 RCE - $305',{ plan_type: 'COMMISSION', campaign: 'D2D' }],
  ['Watts - Texas - ELE - D2D - 60 - 1.2+ RCE - $330',      { plan_type: 'COMMISSION', campaign: 'D2D' }],
  ['Watts - Texas - ELE - D2D - 12 - $80',                  { plan_type: 'COMMISSION', campaign: 'D2D' }],
  ['Watts - Texas - ELE - National Retail LMMM/El Ahorro/Sellers Bros/El Rancho - 36/60- $210', { plan_type: 'COMMISSION', campaign: 'RETAIL' }],
  ['Watts - Texas - ELE - National Retail HEB/ Joe V/Mi Tienda/Kroger/Walmart - 36/60- $230',   { plan_type: 'COMMISSION', campaign: 'RETAIL' }],
  ['Watts - RCE Adder - Texas - ELE - D2D - 36 - 1.60-2.49 RCE - $100', { plan_type: 'RCE_ADDER_D2D', campaign: 'D2D' }],
  ['Watts - RCE Adder - Texas - ELE - D2D - 36 - 2.50-3.49 RCE - $200', { plan_type: 'RCE_ADDER_D2D', campaign: 'D2D' }],
  ['Watts - Texas - ELE - National Retail - 1.4 - 1.9 RCE - $10', { plan_type: 'RCE_ADDER_RETAIL', campaign: 'RETAIL' }],
  ['Watts - Texas - ELE - National Retail - 2.0+ RCE - $20',      { plan_type: 'RCE_ADDER_RETAIL', campaign: 'RETAIL' }],
  ['Watts - TX - ELE - D2D - 60 - 0.6+ RCE - Residual - $50',     { plan_type: 'RESIDUAL_D2D', campaign: 'D2D' }],
  ['Watts - Texas - National Retail - Green - $20',               { plan_type: 'GREEN_BONUS', campaign: 'RETAIL' }],
]);

// Match the API default: payWeek = next Friday on/after cutoff_date.
const cutoffDate = '2026-05-10'; // file name says May 10 2026
function nextFriday(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + ((5 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const payWeek = nextFriday(cutoffDate);

console.log(`\ncutoff_date=${cutoffDate}  →  pay_week=${payWeek}`);

const results = {
  rows: 0,
  manual: 0,
  chargeback: 0,
  verify: 0,
  payable: 0,
  payable_next: 0,
  bonuses_side_effect: 0,
  residuals_side_effect: 0,
  termZeroNullified: 0,
  errors: [],
  byPlan: new Map(),
  manualRows: [],
  chargebackRows: [],
  payableNextWeekRows: [],
};

const dedupKeys = new Map();
const contractAccum = new Map();

for (let r = 2; r <= sheet.actualRowCount; r++) {
  const row = sheet.getRow(r);
  const get = (logical) => idx.get(logical) ? row.getCell(idx.get(logical)).value : null;

  const commission_type = readString(get('commission_type')) || null;
  const plan_name = readString(get('plan_name'));
  const contract_id = readString(get('contract_id'));
  const je_badge = readString(get('je_badge'));
  const rawAmount = readNumber(get('je_paid_amount')) ?? 0;
  const rawTerm = readInt(get('term'));
  const term = rawTerm && rawTerm > 0 ? rawTerm : null;
  if (rawTerm === 0) results.termZeroNullified++;
  const signedDate = readDate(get('contract_signed_date'));
  const notes = readString(get('notes')) || null;

  results.rows++;

  const manual = isManualBonusRow(commission_type);
  if (!manual && (!contract_id || !plan_name || !je_badge)) {
    results.errors.push({ r, msg: `missing contract/plan/badge`, commission_type, plan_name, contract_id, je_badge });
    continue;
  }

  if (manual) {
    results.manual++;
    results.manualRows.push({ r, amount: rawAmount, notes, plan_name });
    continue;
  }

  const mapping = SEEDED_MAPPINGS.get(plan_name);
  const isCb = isChargebackRow(rawAmount, commission_type);

  let status;
  let payWeekForRow = null;
  if (isCb) {
    status = 'CHARGEBACK';
    payWeekForRow = payWeek;
    results.chargeback++;
    results.chargebackRows.push({ r, contract_id, plan_name: plan_name.slice(0, 40), amount: rawAmount });
  } else if (!mapping) {
    status = 'VERIFY';
    results.verify++;
  } else if (mapping.plan_type === 'COMMISSION') {
    if (signedDate && signedDate > cutoffDate) {
      status = 'PAYABLE_NEXT_WEEK';
      payWeekForRow = addDays(payWeek, 7);
      results.payable_next++;
      results.payableNextWeekRows.push({ r, contract_id, plan_name: plan_name.slice(0, 40), signedDate });
    } else {
      status = 'PAYABLE';
      payWeekForRow = payWeek;
      results.payable++;
    }
  } else {
    status = 'PAYABLE';
    payWeekForRow = payWeek;
    results.payable++;
    if (mapping.plan_type === 'RCE_ADDER_D2D' || mapping.plan_type === 'RCE_ADDER_RETAIL') {
      results.bonuses_side_effect++;
    } else if (mapping.plan_type === 'RESIDUAL_D2D' || mapping.plan_type === 'GREEN_BONUS') {
      results.residuals_side_effect++;
    }
  }

  // Plan classification rollup
  const key = `${plan_name.slice(0, 60)} | ${status}`;
  results.byPlan.set(key, (results.byPlan.get(key) ?? 0) + 1);

  // (contract_id, plan_name) dedup detection
  const dKey = `${contract_id}|${plan_name}`;
  const arr = dedupKeys.get(dKey) ?? [];
  arr.push({ r, status, amount: rawAmount });
  dedupKeys.set(dKey, arr);

  const cAcc = contractAccum.get(contract_id) ?? { rows: 0, statuses: [] };
  cAcc.rows++;
  cAcc.statuses.push(status);
  contractAccum.set(contract_id, cAcc);
}

console.log('\n━━━ Classification ━━━');
console.log(`rows total           : ${results.rows}`);
console.log(`manual bonuses       : ${results.manual}`);
console.log(`chargebacks          : ${results.chargeback}`);
console.log(`payable              : ${results.payable}`);
console.log(`payable_next_week    : ${results.payable_next}`);
console.log(`verify (unmapped)    : ${results.verify}`);
console.log(`errors (skipped)     : ${results.errors.length}`);
console.log(`term=0 → NULL        : ${results.termZeroNullified}`);
console.log(`bonus side-effect inserts (RCE adders) : ${results.bonuses_side_effect}`);
console.log(`residual side-effect inserts            : ${results.residuals_side_effect}`);

console.log('\n━━━ Manual bonuses (go to company_bonuses, no payroll_sales) ━━━');
for (const m of results.manualRows) {
  console.log(`  r${m.r}  $${m.amount}  notes="${m.notes}"`);
}

console.log('\n━━━ Chargebacks (status=CHARGEBACK) ━━━');
console.log(`(${results.chargebackRows.length} total — showing first 10)`);
for (const c of results.chargebackRows.slice(0, 10)) {
  console.log(`  r${c.r}  ${c.contract_id}  plan="${c.plan_name}…"  amount=${c.amount}`);
}

console.log('\n━━━ PAYABLE_NEXT_WEEK (Contract Signed Date > cutoff) ━━━');
for (const p of results.payableNextWeekRows.slice(0, 10)) {
  console.log(`  r${p.r}  ${p.contract_id}  plan="${p.plan_name}…"  signed=${p.signedDate}`);
}
if (results.payableNextWeekRows.length === 0) {
  console.log('  (none — confirms cutoff = 2026-05-10 is at or after all signed dates in this file)');
}

console.log('\n━━━ Plan × Status rollup ━━━');
const sorted = [...results.byPlan.entries()].sort((a, b) => b[1] - a[1]);
for (const [k, n] of sorted) console.log(`  (${n}) ${k}`);

console.log('\n━━━ Dedup keys (contract_id | plan_name) appearing > 1 ━━━');
let dupCount = 0;
for (const [k, arr] of dedupKeys.entries()) {
  if (arr.length > 1) {
    dupCount++;
    if (dupCount <= 5) {
      console.log(`  ${k.slice(0, 80)} → ${arr.length} rows`);
      for (const x of arr) console.log(`    r${x.r}  ${x.status}  amount=${x.amount}`);
    }
  }
}
console.log(`  total dup-key groups: ${dupCount}`);

console.log('\n━━━ Per-contract row count distribution ━━━');
const distBuckets = new Map();
for (const [, v] of contractAccum) {
  distBuckets.set(v.rows, (distBuckets.get(v.rows) ?? 0) + 1);
}
for (const [k, n] of [...distBuckets.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  contracts with ${k} row(s): ${n}`);
}

if (results.errors.length > 0) {
  console.log('\n━━━ ⚠ Errors ━━━');
  for (const e of results.errors.slice(0, 10)) console.log(`  r${e.r}  ${e.msg}`, e);
}

console.log('\n✓ dry-run complete (no DB writes)');
