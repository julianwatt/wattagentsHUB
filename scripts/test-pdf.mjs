#!/usr/bin/env node
/**
 * Block 07 — render a sample payfile PDF to disk for manual visual
 * inspection. Uses synthetic data so no DB or auth is needed.
 *
 *   node scripts/test-pdf.mjs       → writes scripts/output/sample-es.pdf
 *   node scripts/test-pdf.mjs en    → writes scripts/output/sample-en.pdf
 *
 * Open the PDF and confirm: header band renders, group subtotals add up,
 * grand total matches, sale-detail page reads cleanly, disclaimer at
 * bottom of last page.
 */
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, 'output');
fs.mkdirSync(outDir, { recursive: true });

const lang = process.argv[2] === 'en' ? 'en' : 'es';

// ── Mirror the production strings (kept here so the script is self-contained).
const STRINGS = {
  es: {
    title: 'Recibo de Nómina', payWeek: 'Semana de pago', version: 'Versión',
    generatedAt: 'Generado', position: 'Position', summaryTitle: 'Resumen de pago',
    subtotal: 'Subtotal', totalFinal: 'TOTAL A PAGAR', detailTitle: 'Detalle de ventas',
    contract: 'Contrato', customer: 'Cliente', plan: 'Plan', saleDate: 'Firma',
    paymentType: 'Concepto', amount: 'Monto', commission: 'Comisión', override: 'Override',
    bonus: 'Bono', collection: 'Cobro', adjustment: 'Ajuste',
    disclaimer: 'Documento generado automáticamente. El monto refleja el cálculo a la fecha de generación. Cualquier disputa debe presentarse dentro de los 5 días hábiles posteriores a la publicación.',
    flagEdited: 'Editado', flagAdded: 'Manual', flagCeoApproval: 'Req. CEO',
    grp_COMMISSION: 'COMISIÓN', grp_OVERRIDE: 'OVERRIDE', grp_COMPANY_BONUS: 'BONO',
    grp_COLLECTION: 'COBRO', grp_MANUAL_ADJUSTMENT: 'AJUSTE MANUAL',
  },
  en: {
    title: 'Payfile Receipt', payWeek: 'Pay week', version: 'Version',
    generatedAt: 'Generated', position: 'Position', summaryTitle: 'Payment summary',
    subtotal: 'Subtotal', totalFinal: 'TOTAL PAYABLE', detailTitle: 'Sales detail',
    contract: 'Contract', customer: 'Customer', plan: 'Plan', saleDate: 'Signed',
    paymentType: 'Concept', amount: 'Amount', commission: 'Commission', override: 'Override',
    bonus: 'Bonus', collection: 'Collection', adjustment: 'Adjustment',
    disclaimer: 'Auto-generated document. The amount reflects the calculation at generation time. Any dispute must be raised within 5 business days of publication.',
    flagEdited: 'Edited', flagAdded: 'Manual', flagCeoApproval: 'CEO Req.',
    grp_COMMISSION: 'COMMISSION', grp_OVERRIDE: 'OVERRIDE', grp_COMPANY_BONUS: 'BONUS',
    grp_COLLECTION: 'COLLECTION', grp_MANUAL_ADJUSTMENT: 'MANUAL ADJUSTMENT',
  },
}[lang];

const NAVY = '#0b182b';
const GOLD = '#c2994b';
const GRAY = '#666666';
const LIGHT = '#e5e7eb';

// ── Synthetic payfile (mirrors the shape returned by getPayfileForUser).
const payfile = { pay_week: '2026-05-15', total_amount: 350, last_version_number: 1 };
const user = { name: 'Lucero Rodriguez', role: 'agent' };
const versionNumber = 1;
const lineItems = [
  // Commissions
  { line_type: 'COMMISSION', description: `${STRINGS.commission} – Watts D2D 60M T3 – X13502731-7620413 – Daniel Ramirez`, amount: 170, original_amount: 170, is_manually_edited: false, is_manually_added: false, requires_ceo_approval: false },
  { line_type: 'COMMISSION', description: `${STRINGS.commission} – Watts Retail Green – X13504910-7622570 – Aaron Martinez`, amount: 20, original_amount: 20, is_manually_edited: false, is_manually_added: false, requires_ceo_approval: false },
  { line_type: 'COMMISSION', description: 'Chargeback – Watts D2D 60M T0 – X13497198-7614912', amount: -50, original_amount: -50, is_manually_edited: false, is_manually_added: false, requires_ceo_approval: false },
  // Overrides
  { line_type: 'OVERRIDE', description: `${STRINGS.override} directo – Watts Retail LMMM – X13505717-7623365`, amount: 20, original_amount: 20, is_manually_edited: false, is_manually_added: false, requires_ceo_approval: false },
  { line_type: 'OVERRIDE', description: `${STRINGS.override} indirecto – Watts Retail Green – X13502448-7620131`, amount: 20, original_amount: 20, is_manually_edited: true, is_manually_added: false, requires_ceo_approval: false },
  // Bonuses
  { line_type: 'COMPANY_BONUS', description: 'RCE Adder D2D 1.60-2.49 – X13493283-7611029', amount: 100, original_amount: 100, is_manually_edited: false, is_manually_added: false, requires_ceo_approval: false },
  // Adjustments
  { line_type: 'MANUAL_ADJUSTMENT', description: `${STRINGS.adjustment} manual de semana anterior`, amount: 70, original_amount: 50, is_manually_edited: true, is_manually_added: true, requires_ceo_approval: false },
];
const saleDetails = [
  { contract_id: 'X13502731-7620413', customer_name: 'Daniel Ramirez', plan_name: 'Watts - Texas - ELE - D2D - 60 - 0.7 - 1.19 RCE - $305', contract_signed_date: '2026-05-08', payment_type: STRINGS.commission, amount: 170 },
  { contract_id: 'X13504910-7622570', customer_name: 'Aaron Martinez', plan_name: 'Watts - Texas - National Retail - Green - $20', contract_signed_date: '2026-05-09', payment_type: STRINGS.commission, amount: 20 },
  { contract_id: 'X13497198-7614912', customer_name: 'Mario Lopez',    plan_name: 'Watts - Texas - ELE - D2D - 60 - 0.40-0.59 RCE - $95', contract_signed_date: '2026-05-02', payment_type: `Chargeback ${STRINGS.commission}`, amount: -50 },
  { contract_id: 'X13505717-7623365', customer_name: 'Sofia Diaz',     plan_name: 'Watts - Texas - ELE - National Retail LMMM/...',      contract_signed_date: '2026-05-10', payment_type: `${STRINGS.override} (M2)`, amount: 20 },
];
// Total: 170+20-50+20+20+100+70 = 350 ✓
const totalFromItems = lineItems.reduce((acc, li) => acc + li.amount, 0);
console.log(`Total from items: $${totalFromItems.toFixed(2)}  (expected $${payfile.total_amount.toFixed(2)})`);

const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
const chunks = [];
doc.on('data', (c) => chunks.push(c));
doc.on('end', () => {
  const buf = Buffer.concat(chunks);
  const out = path.join(outDir, `sample-${lang}.pdf`);
  fs.writeFileSync(out, buf);
  console.log(`✓ Wrote ${out} (${buf.byteLength} bytes)`);
});

function fmt(n) { return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`; }

// Header
doc.rect(0, 0, doc.page.width, 90).fill(NAVY);
doc.fillColor('white').font('Helvetica-Bold').fontSize(20).text('WATTS', 50, 28);
doc.font('Helvetica').fontSize(10).fillColor(GOLD).text('DISTRIBUTORS LLC', 50, 52);
doc.font('Helvetica-Bold').fontSize(14).fillColor('white').text(STRINGS.title, 50, 65);
const metaX = doc.page.width - 50 - 230;
doc.font('Helvetica').fontSize(8).fillColor('white')
  .text(`${STRINGS.payWeek}: ${payfile.pay_week}`, metaX, 28, { width: 230, align: 'right' })
  .text(`${STRINGS.version}: v${versionNumber}`, metaX, 42, { width: 230, align: 'right' })
  .text(`${STRINGS.generatedAt}: ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`, metaX, 56, { width: 230, align: 'right' });

doc.fillColor('black').font('Helvetica-Bold').fontSize(13).text(user.name, 50, 110);
doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(`${STRINGS.position}: ${user.role}`, 50, 128);
doc.y = 160;

// Summary
doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text(STRINGS.summaryTitle, 50, doc.y);
doc.moveDown(0.5);

const groups = {};
for (const li of lineItems) (groups[li.line_type] ??= []).push(li);
const order = ['COMMISSION', 'OVERRIDE', 'COMPANY_BONUS', 'COLLECTION', 'MANUAL_ADJUSTMENT'];
const colDesc = 50;
const colAmt = doc.page.width - 50 - 100;
for (const k of order) {
  const arr = groups[k];
  if (!arr) continue;
  const y = doc.y;
  doc.rect(colDesc, y, doc.page.width - 100, 16).fill(LIGHT);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text(STRINGS[`grp_${k}`] ?? k, colDesc + 4, y + 4);
  doc.y = y + 20;
  for (const li of arr) {
    const liY = doc.y;
    doc.font('Helvetica').fontSize(8.5).fillColor('black').text(li.description, colDesc + 4, liY, { width: colAmt - colDesc - 8 });
    doc.text(fmt(li.amount), colAmt, liY, { width: 100, align: 'right' });
    const flags = [];
    if (li.is_manually_edited) flags.push(STRINGS.flagEdited);
    if (li.is_manually_added) flags.push(STRINGS.flagAdded);
    if (li.requires_ceo_approval) flags.push(STRINGS.flagCeoApproval);
    if (flags.length) doc.font('Helvetica-Oblique').fontSize(7).fillColor(GRAY).text(flags.join(' · '), colDesc + 4, doc.y, { width: colAmt - colDesc - 8 });
    doc.moveDown(0.3);
  }
  const subtotal = arr.reduce((acc, l) => acc + l.amount, 0);
  const subY = doc.y;
  doc.moveTo(colAmt, subY).lineTo(colAmt + 100, subY).strokeColor(NAVY).lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY).text(`${STRINGS.subtotal}:`, colDesc + 4, doc.y);
  doc.font('Helvetica-Bold').fontSize(8.5).text(fmt(subtotal), colAmt, doc.y - 11, { width: 100, align: 'right' });
  doc.moveDown(1);
}

// Total bar
doc.moveDown(0.5);
const ty = doc.y;
doc.rect(50, ty, doc.page.width - 100, 28).fill(NAVY);
doc.font('Helvetica-Bold').fontSize(11).fillColor('white').text(STRINGS.totalFinal, 54, ty + 9);
doc.font('Helvetica-Bold').fontSize(13).fillColor(GOLD)
  .text(fmt(payfile.total_amount), doc.page.width - 50 - 120, ty + 7, { width: 120, align: 'right' });
doc.y = ty + 36;

// Sale detail page
doc.addPage();
doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY).text(STRINGS.detailTitle, 50, 50);
doc.moveDown(0.5);
const cols = [
  { label: STRINGS.contract,    key: 'contract_id',         width: 95,  align: 'left' },
  { label: STRINGS.customer,    key: 'customer_name',       width: 110, align: 'left' },
  { label: STRINGS.plan,        key: 'plan_name',           width: 150, align: 'left' },
  { label: STRINGS.saleDate,    key: 'contract_signed_date',width:  55, align: 'left' },
  { label: STRINGS.paymentType, key: 'payment_type',        width:  60, align: 'left' },
  { label: STRINGS.amount,      key: 'amount',              width:  42, align: 'right' },
];
const startX = 50;
let y = doc.y;
doc.rect(startX, y, doc.page.width - 100, 16).fill(LIGHT);
let x = startX + 2;
for (const c of cols) {
  doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY).text(c.label, x, y + 4, { width: c.width - 4, align: c.align });
  x += c.width;
}
y += 20;
for (const row of saleDetails) {
  x = startX + 2;
  for (const c of cols) {
    const value = c.key === 'amount' ? fmt(row[c.key]) : String(row[c.key] ?? '');
    doc.font('Helvetica').fontSize(7.5).fillColor('black').text(value, x, y, { width: c.width - 4, align: c.align, ellipsis: true });
    x += c.width;
  }
  y += 14;
}
doc.y = y;

// Disclaimer
doc.font('Helvetica-Oblique').fontSize(7).fillColor(GRAY).text(STRINGS.disclaimer, 50, doc.page.height - 70, {
  width: doc.page.width - 100, align: 'justify',
});

doc.end();
