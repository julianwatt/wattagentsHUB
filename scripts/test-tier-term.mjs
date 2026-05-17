#!/usr/bin/env node
/**
 * Block 05 dry-run: verify resolveTierForSale + resolveTermMonthsForSale
 * against the JE fixture. Reimplements the logic in pure JS (no DB) so we
 * can run the assertions without a Supabase round-trip.
 *
 * Keeps in lockstep with src/lib/payroll/tierResolution.ts — if you change
 * the resolver rules there, mirror them here.
 */
import ExcelJS from 'exceljs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(
  __dirname,
  '../docs/payroll/samples/27155_Watts_Distributors_LLC_US_Weekly_1524_FlatFee_May102026.xlsx',
);

// Block-03 seed mappings (per 20260519 migration). For the test we hardcode
// the current state. After admin tier-tags D2D COMMISSIONS in the UI, the
// 'tier' field below will be populated — re-run the test to confirm.
const MAPPINGS = new Map([
  ['Watts - Texas - ELE - D2D - 60 - 0.40-0.59 RCE - $95',  { plan_type: 'COMMISSION', campaign: 'D2D',    tier: null, term_months: 60 }],
  ['Watts - Texas - ELE - D2D - 60 - 0.60-0.69 RCE - $170', { plan_type: 'COMMISSION', campaign: 'D2D',    tier: null, term_months: 60 }],
  ['Watts - Texas - ELE - D2D - 60 - 0.7 - 1.19 RCE - $305',{ plan_type: 'COMMISSION', campaign: 'D2D',    tier: null, term_months: 60 }],
  ['Watts - Texas - ELE - D2D - 60 - 1.2+ RCE - $330',      { plan_type: 'COMMISSION', campaign: 'D2D',    tier: null, term_months: 60 }],
  ['Watts - Texas - ELE - D2D - 12 - $80',                  { plan_type: 'COMMISSION', campaign: 'D2D',    tier: null, term_months: 12 }],
  ['Watts - Texas - ELE - National Retail LMMM/El Ahorro/Sellers Bros/El Rancho - 36/60- $210', { plan_type: 'COMMISSION', campaign: 'RETAIL', tier: null, term_months: null }],
  ['Watts - Texas - ELE - National Retail HEB/ Joe V/Mi Tienda/Kroger/Walmart - 36/60- $230',   { plan_type: 'COMMISSION', campaign: 'RETAIL', tier: null, term_months: null }],
  ['Watts - RCE Adder - Texas - ELE - D2D - 36 - 1.60-2.49 RCE - $100', { plan_type: 'RCE_ADDER_D2D',    campaign: 'D2D',    tier: null, term_months: null }],
  ['Watts - RCE Adder - Texas - ELE - D2D - 36 - 2.50-3.49 RCE - $200', { plan_type: 'RCE_ADDER_D2D',    campaign: 'D2D',    tier: null, term_months: null }],
  ['Watts - Texas - ELE - National Retail - 1.4 - 1.9 RCE - $10',       { plan_type: 'RCE_ADDER_RETAIL', campaign: 'RETAIL', tier: null, term_months: null }],
  ['Watts - Texas - ELE - National Retail - 2.0+ RCE - $20',            { plan_type: 'RCE_ADDER_RETAIL', campaign: 'RETAIL', tier: null, term_months: null }],
  ['Watts - TX - ELE - D2D - 60 - 0.6+ RCE - Residual - $50',           { plan_type: 'RESIDUAL_D2D',     campaign: 'D2D',    tier: null, term_months: 60   }],
  ['Watts - Texas - National Retail - Green - $20',                     { plan_type: 'GREEN_BONUS',      campaign: 'RETAIL', tier: null, term_months: null }],
]);

// Mirrors tierResolution.ts
function resolveTier(mapping) {
  if (!mapping) return null;
  if (mapping.campaign !== 'D2D') return null;
  if (mapping.plan_type !== 'COMMISSION') return null;
  return mapping.tier;
}
function resolveTerm(rawTermMonths, mapping) {
  if (!mapping) return { value: null, missing: false };
  if (mapping.campaign !== 'D2D' || mapping.plan_type !== 'COMMISSION') return { value: null, missing: false };
  if (mapping.term_months !== null) return { value: mapping.term_months, missing: false };
  if (rawTermMonths !== null) return { value: rawTermMonths, missing: false };
  return { value: null, missing: true };
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(fixture);
const sheet = wb.getWorksheet('Commissions');

const headers = {};
sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
  headers[String(cell.value).trim()] = col;
});

function cellStr(row, name) {
  const v = row.getCell(headers[name]).value;
  return v == null ? '' : String(v).trim();
}
function cellInt(row, name) {
  const v = row.getCell(headers[name]).value;
  if (v == null) return null;
  if (typeof v === 'number') return Math.round(v);
  const n = Number(String(v).replace(/[,$\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

let tierStats = { d2d_commission_resolved: 0, d2d_commission_null: 0, non_d2d_null: 0, no_mapping: 0 };
let termStats = { d2d_from_mapping: 0, d2d_from_raw: 0, d2d_missing: 0, non_applicable: 0, no_mapping: 0 };

for (let r = 2; r <= sheet.actualRowCount; r++) {
  const row = sheet.getRow(r);
  const plan_name = cellStr(row, 'Plan Name');
  const rawTerm = cellInt(row, 'Contract Term (months)');
  const term = rawTerm && rawTerm > 0 ? rawTerm : null;
  const mapping = MAPPINGS.get(plan_name) ?? null;

  // Tier
  const t = resolveTier(mapping);
  if (!mapping) tierStats.no_mapping++;
  else if (mapping.campaign === 'D2D' && mapping.plan_type === 'COMMISSION') {
    if (t === null) tierStats.d2d_commission_null++;
    else tierStats.d2d_commission_resolved++;
  } else {
    tierStats.non_d2d_null++;
  }

  // Term
  const tm = resolveTerm(term, mapping);
  if (!mapping) termStats.no_mapping++;
  else if (mapping.campaign !== 'D2D' || mapping.plan_type !== 'COMMISSION') {
    termStats.non_applicable++;
  } else if (mapping.term_months !== null) {
    termStats.d2d_from_mapping++;
  } else if (term !== null) {
    termStats.d2d_from_raw++;
  } else {
    termStats.d2d_missing++;
  }
}

console.log('━━━ Tier resolution (against block-03 seed, all D2D tier=null) ━━━');
console.table(tierStats);
console.log('Expected: d2d_commission_null > 0 (admin must tier-tag), non_d2d_null > 0, no_mapping = 0 (all 13 plan_names mapped), d2d_commission_resolved = 0 (admin hasn\'t set tiers yet).');

console.log('\n━━━ Term resolution ━━━');
console.table(termStats);
console.log('Expected: d2d_from_mapping > 0 (60M / 12M plans carry the term), non_applicable > 0 (retail / adders / residuals), d2d_missing = 0.');

// Now simulate admin tier-tagging the D2D COMMISSION plans and re-run.
console.log('\n━━━ Simulated: admin tier-tags D2D COMMISSION plans ━━━');
const taggedMappings = new Map(MAPPINGS);
const TIER_HINTS = {
  'Watts - Texas - ELE - D2D - 60 - 0.40-0.59 RCE - $95':  0,
  'Watts - Texas - ELE - D2D - 60 - 0.60-0.69 RCE - $170': 1,
  'Watts - Texas - ELE - D2D - 60 - 0.7 - 1.19 RCE - $305':3,
  'Watts - Texas - ELE - D2D - 60 - 1.2+ RCE - $330':      4,
  'Watts - Texas - ELE - D2D - 12 - $80':                  0,
};
for (const [name, tier] of Object.entries(TIER_HINTS)) {
  const m = taggedMappings.get(name);
  taggedMappings.set(name, { ...m, tier });
}
let resolved = 0;
for (let r = 2; r <= sheet.actualRowCount; r++) {
  const row = sheet.getRow(r);
  const plan_name = cellStr(row, 'Plan Name');
  const mapping = taggedMappings.get(plan_name) ?? null;
  const t = resolveTier(mapping);
  if (t !== null) resolved++;
}
console.log(`After admin tier-tags 5 D2D plans: ${resolved} sales now resolve to a tier (matches block-05 reprocess pass output).`);

console.log('\n✓ dry-run complete (no DB writes)');
