#!/usr/bin/env node
/**
 * One-shot inspection of the JE weekly sample file.
 * Reports: sheet names, row counts, header row, columns + inferred dtype,
 * uniques on the columns that drive parsing (Disposition, Marketing Channel,
 * Term, Plan Name).
 *
 * Usage: node scripts/inspect-je-sample.mjs <path-to-xlsx>
 * Default: docs/payroll/samples/<the-fixture>
 */
import ExcelJS from 'exceljs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(
  __dirname,
  '../docs/payroll/samples/27155_Watts_Distributors_LLC_US_Weekly_1524_FlatFee_May102026.xlsx',
);

const filePath = process.argv[2] ?? DEFAULT_PATH;

function inferType(v) {
  if (v == null || v === '') return 'empty';
  if (v instanceof Date) return 'date';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'object') {
    if ('text' in v) return 'richText';
    if ('result' in v) return 'formula';
    if ('hyperlink' in v) return 'hyperlink';
    return 'object';
  }
  return 'string';
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(filePath);

console.log('═════════════════════════════════════════════════════════');
console.log('File:', path.basename(filePath));
console.log('Sheets:', wb.worksheets.map((s) => s.name).join(', '));
console.log('═════════════════════════════════════════════════════════');

for (const sheet of wb.worksheets) {
  console.log(`\n──── Sheet: "${sheet.name}" ────────────────`);
  console.log(`Total rows: ${sheet.actualRowCount}   columns: ${sheet.actualColumnCount}`);

  // Detect header row (first row with text in most cells)
  let headerRowNum = 1;
  for (let r = 1; r <= Math.min(5, sheet.actualRowCount); r++) {
    const row = sheet.getRow(r);
    let textCells = 0;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value === 'string') textCells++;
    });
    if (textCells >= 3) { headerRowNum = r; break; }
  }
  console.log(`Header row detected at: ${headerRowNum}`);

  const headerRow = sheet.getRow(headerRowNum);
  const headers = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    headers.push({ col, name: String(cell.value).trim() });
  });
  console.log('Headers:');
  for (const h of headers) console.log(`  [${h.col}] ${h.name}`);

  // Inspect first 3 data rows for dtype inference + sample values
  console.log('\nFirst data rows (dtypes + values):');
  const sampleN = Math.min(3, sheet.actualRowCount - headerRowNum);
  for (let r = headerRowNum + 1; r <= headerRowNum + sampleN; r++) {
    const row = sheet.getRow(r);
    console.log(`  Row ${r}:`);
    for (const h of headers) {
      const cell = row.getCell(h.col);
      const t = inferType(cell.value);
      let display = '';
      if (cell.value instanceof Date) display = cell.value.toISOString().slice(0, 10);
      else if (cell.value != null && typeof cell.value === 'object') display = JSON.stringify(cell.value).slice(0, 80);
      else display = String(cell.value ?? '').slice(0, 60);
      console.log(`     ${h.name}: <${t}> ${display}`);
    }
  }

  // Unique values for parsing-driver columns
  const driverCols = ['disposition', 'marketing channel', 'term', 'plan name', 'plan type'];
  const driverHits = headers.filter((h) =>
    driverCols.some((d) => h.name.toLowerCase().includes(d)),
  );

  for (const h of driverHits) {
    const uniques = new Map();
    for (let r = headerRowNum + 1; r <= sheet.actualRowCount; r++) {
      const v = sheet.getRow(r).getCell(h.col).value;
      const key = v == null ? '<null>' : String(v).trim();
      uniques.set(key, (uniques.get(key) ?? 0) + 1);
    }
    console.log(`\nUnique values of "${h.name}" (${uniques.size}):`);
    const sorted = [...uniques.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    for (const [k, n] of sorted) {
      console.log(`  (${n}) ${k.length > 100 ? k.slice(0, 97) + '…' : k}`);
    }
    if (uniques.size > 20) console.log(`  … +${uniques.size - 20} more`);
  }
}
