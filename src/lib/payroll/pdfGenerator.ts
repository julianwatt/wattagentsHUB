/**
 * Block 07 — Payfile PDF generator.
 * ============================================================================
 *
 * Renders a payfile to a PDF Buffer using pdfkit. Server-side only.
 *
 * Two entry points:
 *   - generatePayfilePdf(payfileId, viewer)  →  builds from live DB data
 *     (used for previews, and for the first-time publish that hasn't
 *     written a snapshot yet).
 *   - generatePayfilePdfFromSnapshot(snapshotJson, viewer)  →  builds
 *     from the immutable payfile_versions.snapshot_json (used for
 *     regeneration after a template change).
 *
 * Privacy: line items are filtered through payfilePrivacy.getPayfileForUser
 * when the viewer is not Admin / CEO. The override-strip rule (a manager
 * doesn't see other managers' overrides on the same sale) is enforced
 * exactly once, inside that helper.
 *
 * Layout: pure-text header + grouped line-items table (Comisiones,
 * Overrides, Bonos, Cobros, Ajustes) + totals + sale-detail second page +
 * disclaimer. SVG logo embedding is intentionally deferred — pdfkit's
 * SVG support requires svg-to-pdfkit and a Cairo build; not worth the
 * dependency for a v1.
 */

import PDFDocument from 'pdfkit';
import { supabase } from '@/lib/supabase';
import { getPayfileForUser, type ViewerCtx } from '@/lib/payroll/payfilePrivacy';
import { payfileLineTypeLabel } from '@/lib/payroll/labels';
import type { PayfileLineItem, PayfileOverride } from '@/types/payroll';
import type { PayfileLineType } from '@/lib/payroll/constants';
import type { Lang } from '@/lib/i18n';

// ── i18n: every PDF string lives here so the bundle isn't pulled into ───────
// the client bundle via i18n.ts (server-only).
interface PdfStrings {
  title: string; subtitle: string;
  person: string; position: string; campaign: string;
  payWeek: string; version: string; generatedAt: string;
  summaryTitle: string;
  type: string; description: string; amount: string;
  subtotal: string; totalFinal: string;
  detailTitle: string;
  contract: string; customer: string; plan: string;
  saleDate: string; paymentType: string;
  commission: string; override: string; bonus: string; collection: string; adjustment: string;
  noData: string;
  disclaimer: string;
  pageOf: string;
  flagEdited: string; flagAdded: string; flagCeoApproval: string;
}

const PDF_STRINGS: Record<'es' | 'en', PdfStrings> = {
  es: {
    title: 'Recibo de Nómina',
    subtitle: 'Watts Distributors LLC',
    person: 'Persona',
    position: 'Position',
    campaign: 'Campaña',
    payWeek: 'Semana de pago',
    version: 'Versión',
    generatedAt: 'Generado',
    summaryTitle: 'Resumen de pago',
    type: 'Tipo',
    description: 'Descripción',
    amount: 'Monto',
    subtotal: 'Subtotal',
    totalFinal: 'TOTAL A PAGAR',
    detailTitle: 'Detalle de ventas',
    contract: 'Contrato',
    customer: 'Cliente',
    plan: 'Plan',
    saleDate: 'Firma',
    paymentType: 'Concepto',
    commission: 'Comisión',
    override: 'Override',
    bonus: 'Bono',
    collection: 'Cobro',
    adjustment: 'Ajuste',
    noData: 'Sin líneas en este payfile.',
    disclaimer: 'Documento generado automáticamente. El monto refleja el cálculo a la fecha de generación. Cualquier disputa debe presentarse dentro de los 5 días hábiles posteriores a la publicación.',
    pageOf: 'Página {n} de {t}',
    flagEdited: 'Editado',
    flagAdded: 'Manual',
    flagCeoApproval: 'Req. CEO',
  },
  en: {
    title: 'Payfile Receipt',
    subtitle: 'Watts Distributors LLC',
    person: 'Recipient',
    position: 'Position',
    campaign: 'Campaign',
    payWeek: 'Pay week',
    version: 'Version',
    generatedAt: 'Generated',
    summaryTitle: 'Payment summary',
    type: 'Type',
    description: 'Description',
    amount: 'Amount',
    subtotal: 'Subtotal',
    totalFinal: 'TOTAL PAYABLE',
    detailTitle: 'Sales detail',
    contract: 'Contract',
    customer: 'Customer',
    plan: 'Plan',
    saleDate: 'Signed',
    paymentType: 'Concept',
    commission: 'Commission',
    override: 'Override',
    bonus: 'Bonus',
    collection: 'Collection',
    adjustment: 'Adjustment',
    noData: 'No lines in this payfile.',
    disclaimer: 'Auto-generated document. The amount reflects the calculation at generation time. Any dispute must be raised within 5 business days of publication.',
    pageOf: 'Page {n} of {t}',
    flagEdited: 'Edited',
    flagAdded: 'Manual',
    flagCeoApproval: 'CEO Req.',
  },
};

const NAVY = '#0b182b';
const GOLD = '#c2994b';
const GRAY = '#666666';
const LIGHT_GRAY = '#e5e7eb';

// ── Shapes the renderer expects (snapshot or live) ──────────────────────────

export interface PdfSnapshot {
  payfile: {
    id: string;
    user_id: string;
    pay_week: string;
    state: string;
    total_amount: number;
    last_version_number: number;
  };
  user: {
    name: string;
    role: string;
    language: Lang;
  };
  line_items: PayfileLineItem[];
  sale_details: SaleDetail[];
  /** Effective version number (for the header). */
  version_number: number;
}

export interface SaleDetail {
  contract_id: string;
  customer_name: string | null;
  plan_name: string;
  contract_signed_date: string | null;
  /** "Comisión" / "Override Mgr 1" / etc. — already localised by the caller. */
  payment_type: string;
  amount: number;
}

// ── Public API: live build ──────────────────────────────────────────────────

export async function generatePayfilePdf(
  payfileId: string,
  viewer: ViewerCtx,
): Promise<Buffer> {
  const bundle = await getPayfileForUser(payfileId, viewer);
  if (!bundle) {
    throw new Error('Payfile no encontrado o sin acceso para este viewer.');
  }

  const { data: user } = await supabase
    .from('users')
    .select('name, role, language')
    .eq('id', bundle.payfile.user_id)
    .single();
  const lang: Lang = (user?.language === 'en' ? 'en' : 'es');

  const sale_details = await buildSaleDetails(bundle.line_items, bundle.overrides, lang);

  const snapshot: PdfSnapshot = {
    payfile: bundle.payfile,
    user: {
      name: user?.name ?? bundle.payfile.user_id,
      role: user?.role ?? '',
      language: lang,
    },
    line_items: bundle.line_items,
    sale_details,
    version_number: bundle.payfile.last_version_number || 1,
  };
  return renderPdf(snapshot);
}

// ── Public API: render-from-snapshot ────────────────────────────────────────

export function generatePayfilePdfFromSnapshot(
  snapshot: PdfSnapshot,
): Promise<Buffer> {
  return renderPdf(snapshot);
}

// ── Sale-detail builder (live mode) ─────────────────────────────────────────

async function buildSaleDetails(
  lineItems: PayfileLineItem[],
  overrides: PayfileOverride[],
  lang: Lang,
): Promise<SaleDetail[]> {
  const saleIds = Array.from(new Set(
    lineItems.map((li) => li.source_sale_id).filter((id): id is string => !!id),
  ));
  if (saleIds.length === 0) return [];

  const { data: sales } = await supabase
    .from('payroll_sales')
    .select('id, contract_id, customer_name, plan_name, contract_signed_date')
    .in('id', saleIds);

  type SaleRef = { id: string; contract_id: string; customer_name: string | null; plan_name: string; contract_signed_date: string | null };
  const byId = new Map<string, SaleRef>(
    (sales ?? []).map((s) => [s.id as string, s as SaleRef]),
  );

  const t = PDF_STRINGS[lang];
  const details: SaleDetail[] = [];
  for (const li of lineItems) {
    if (!li.source_sale_id) continue;
    const sale = byId.get(li.source_sale_id);
    if (!sale) continue;
    let paymentType = t.adjustment;
    if (li.line_type === 'COMMISSION') paymentType = t.commission;
    else if (li.line_type === 'OVERRIDE') {
      const ov = overrides.find((o) => o.sale_id === li.source_sale_id && o.payfile_line_item_id === li.id);
      const lvl = ov ? ov.manager_level.replace('_', ' ') : '';
      paymentType = `${t.override}${lvl ? ` (${lvl})` : ''}`;
    }
    else if (li.line_type === 'COMPANY_BONUS') paymentType = t.bonus;
    else if (li.line_type === 'COLLECTION' || li.line_type === 'NEGATIVE_BALANCE_COLLECTION') paymentType = t.collection;

    details.push({
      contract_id: sale.contract_id,
      customer_name: sale.customer_name,
      plan_name: sale.plan_name,
      contract_signed_date: sale.contract_signed_date,
      payment_type: paymentType,
      amount: Number(li.amount),
    });
  }
  return details;
}

// ── Renderer ────────────────────────────────────────────────────────────────

function renderPdf(snapshot: PdfSnapshot): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const lang = snapshot.user.language === 'en' ? 'en' : 'es';
    const t = PDF_STRINGS[lang];

    renderHeader(doc, snapshot, t);
    renderLineItems(doc, snapshot, t);
    renderTotal(doc, snapshot, t);
    if (snapshot.sale_details.length > 0) {
      doc.addPage();
      renderSaleDetails(doc, snapshot, t);
    }
    renderDisclaimer(doc, t);

    doc.end();
  });
}

function renderHeader(doc: PDFKit.PDFDocument, s: PdfSnapshot, t: PdfStrings) {
  // Navy band across the top
  doc.rect(0, 0, doc.page.width, 90).fill(NAVY);
  doc
    .fillColor('white')
    .font('Helvetica-Bold')
    .fontSize(20)
    .text('WATTS', 50, 28);
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(GOLD)
    .text('DISTRIBUTORS LLC', 50, 52);
  doc
    .font('Helvetica-Bold')
    .fontSize(14)
    .fillColor('white')
    .text(t.title, 50, 65);

  // Metadata box on the right
  const metaX = doc.page.width - 50 - 230;
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('white')
    .text(`${t.payWeek}: ${s.payfile.pay_week}`, metaX, 28, { width: 230, align: 'right' })
    .text(`${t.version}: v${s.version_number}`, metaX, 42, { width: 230, align: 'right' })
    .text(`${t.generatedAt}: ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`, metaX, 56, { width: 230, align: 'right' });

  // Person block
  doc
    .fillColor('black')
    .font('Helvetica-Bold')
    .fontSize(13)
    .text(s.user.name, 50, 110);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(GRAY)
    .text(`${t.position}: ${s.user.role}`, 50, 128);

  doc.moveDown(2);
  doc.y = 160;
}

function renderLineItems(doc: PDFKit.PDFDocument, s: PdfSnapshot, t: PdfStrings) {
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(NAVY)
    .text(t.summaryTitle, 50, doc.y);
  doc.moveDown(0.5);

  if (s.line_items.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(t.noData);
    return;
  }

  // Group by line_type
  const groups: Record<string, PayfileLineItem[]> = {};
  for (const li of s.line_items) {
    (groups[li.line_type] ??= []).push(li);
  }

  const groupOrder: PayfileLineType[] = [
    'COMMISSION', 'OVERRIDE', 'COMPANY_BONUS',
    'NEGATIVE_BALANCE_COLLECTION', 'COLLECTION', 'MANUAL_ADJUSTMENT',
  ];

  const startX = 50;
  const colDescX = 50;
  const colAmountX = doc.page.width - 50 - 100;

  for (const groupType of groupOrder) {
    const items = groups[groupType];
    if (!items || items.length === 0) continue;

    // Group header bar
    const y = doc.y;
    doc
      .rect(startX, y, doc.page.width - 100, 16)
      .fill(LIGHT_GRAY);
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(NAVY)
      .text(payfileLineTypeLabel(groupType as PayfileLineType, s.user.language as Lang).toUpperCase(),
        colDescX + 4, y + 4);
    doc.y = y + 20;

    // Items
    for (const li of items) {
      const liY = doc.y;
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor('black')
        .text(li.description, colDescX + 4, liY, { width: colAmountX - colDescX - 8 });
      doc
        .text(formatMoney(Number(li.amount)), colAmountX, liY, { width: 100, align: 'right' });

      // Flag suffix
      const flags: string[] = [];
      if (li.is_manually_edited) flags.push(t.flagEdited);
      if (li.is_manually_added) flags.push(t.flagAdded);
      if (li.requires_ceo_approval) flags.push(t.flagCeoApproval);
      if (flags.length > 0) {
        doc
          .font('Helvetica-Oblique')
          .fontSize(7)
          .fillColor(GRAY)
          .text(flags.join(' · '), colDescX + 4, doc.y, { width: colAmountX - colDescX - 8 });
      }

      doc.moveDown(0.3);
      if (doc.y > doc.page.height - 100) {
        doc.addPage();
      }
    }

    // Subtotal
    const subtotal = items.reduce((acc, li) => acc + Number(li.amount), 0);
    const subY = doc.y;
    doc
      .moveTo(colAmountX, subY)
      .lineTo(colAmountX + 100, subY)
      .strokeColor(NAVY)
      .lineWidth(0.5)
      .stroke();
    doc.moveDown(0.2);
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(NAVY)
      .text(`${t.subtotal}:`, colDescX + 4, doc.y, { continued: false });
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text(formatMoney(subtotal), colAmountX, doc.y - 11, { width: 100, align: 'right' });
    doc.moveDown(1);
  }
}

function renderTotal(doc: PDFKit.PDFDocument, s: PdfSnapshot, t: PdfStrings) {
  doc.moveDown(0.5);
  const y = doc.y;
  doc
    .rect(50, y, doc.page.width - 100, 28)
    .fill(NAVY);
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor('white')
    .text(t.totalFinal, 54, y + 9);
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(GOLD)
    .text(formatMoney(Number(s.payfile.total_amount)),
      doc.page.width - 50 - 120, y + 7, { width: 120, align: 'right' });
  doc.y = y + 36;
}

function renderSaleDetails(doc: PDFKit.PDFDocument, s: PdfSnapshot, t: PdfStrings) {
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(NAVY)
    .text(t.detailTitle, 50, 50);
  doc.moveDown(0.5);

  // Column widths sum should be page-100 = 512 for Letter at 50pt margins.
  const cols: { label: string; key: keyof SaleDetail; width: number; align: 'left' | 'right' }[] = [
    { label: t.contract,    key: 'contract_id',         width: 95,  align: 'left' },
    { label: t.customer,    key: 'customer_name',       width: 110, align: 'left' },
    { label: t.plan,        key: 'plan_name',           width: 150, align: 'left' },
    { label: t.saleDate,    key: 'contract_signed_date',width:  55, align: 'left' },
    { label: t.paymentType, key: 'payment_type',        width:  60, align: 'left' },
    { label: t.amount,      key: 'amount',              width:  42, align: 'right' },
  ];

  const startX = 50;
  let y = doc.y;
  doc.rect(startX, y, doc.page.width - 100, 16).fill(LIGHT_GRAY);
  let x = startX + 2;
  for (const c of cols) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY)
       .text(c.label, x, y + 4, { width: c.width - 4, align: c.align });
    x += c.width;
  }
  y += 20;

  for (const row of s.sale_details) {
    if (y > doc.page.height - 80) {
      doc.addPage();
      y = 50;
    }
    x = startX + 2;
    for (const c of cols) {
      const raw = row[c.key];
      const value = c.key === 'amount'
        ? formatMoney(Number(raw))
        : String(raw ?? '');
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('black')
        .text(value, x, y, { width: c.width - 4, align: c.align, ellipsis: true });
      x += c.width;
    }
    y += 14;
  }
  doc.y = y;
}

function renderDisclaimer(doc: PDFKit.PDFDocument, t: PdfStrings) {
  doc.moveDown(1);
  // Don't redraw on top of an existing section if we're at the page bottom.
  if (doc.y > doc.page.height - 80) doc.addPage();
  doc
    .font('Helvetica-Oblique')
    .fontSize(7)
    .fillColor(GRAY)
    .text(t.disclaimer, 50, doc.page.height - 70, {
      width: doc.page.width - 100,
      align: 'justify',
    });
}

function formatMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n).toFixed(2);
  return `${sign}$${abs}`;
}
