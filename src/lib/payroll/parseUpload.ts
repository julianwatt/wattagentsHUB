/**
 * Payroll system — JE file parser (Block 04).
 * ============================================================================
 *
 * Reads a .xlsx buffer, resolves each row's plan mapping and badge owner,
 * classifies it (PAYABLE / PAYABLE_NEXT_WEEK / CHARGEBACK / VERIFY) and
 * inserts into payroll_sales (and, for adders/residuals/manual bonuses,
 * into company_bonuses / residuals as well).
 *
 * Idempotency: parseUpload(uploadId) can be called repeatedly on the same
 * upload. Before re-running it wipes the upload's previous payroll_sales /
 * company_bonuses / residuals / row_errors rows so a reprocess never
 * leaves stale data behind. Soft-deleted uploads are skipped.
 *
 * Server-side only — never import from a client component.
 */

import ExcelJS from 'exceljs';
import { supabase, getSupabase } from '@/lib/supabase';
import {
  COMMISSIONS_SHEET_NAME,
  resolveHeaderIndex,
  normalizeHeader,
  addDays,
  isManualBonusRow,
  isChargebackRow,
} from '@/lib/payroll/uploadConfig';
import { resolvePlanMapping, defaultStatusForPlanType } from '@/lib/payroll/planMapping';
import { resolveTierForSale, resolveTermMonthsForSale } from '@/lib/payroll/tierResolution';
import type { SaleStatus } from '@/lib/payroll/constants';
import type { PlanMapping } from '@/types/payroll';

const STORAGE_BUCKET = 'payroll-uploads';

// ── Public surface ───────────────────────────────────────────────────────────

export interface UploadParseSummary {
  uploadId: string;
  totalRows: number;
  insertedSales: number;
  insertedBonuses: number;
  insertedResiduals: number;
  errors: number;
  byStatus: Record<SaleStatus, number>;
  winbackCount: number;
  cancelledByChargebackCount: number;
  badgeAlertsCount: number;
  verifyPlans: string[];
}

export interface ParseOptions {
  /** Skip the wipe step (only valid for the first-time parse). */
  isFirstRun?: boolean;
}

/**
 * Entry point. Downloads the file from Storage, parses it, writes all
 * derived rows, updates payroll_uploads with the final status. Returns
 * a summary the API hands back to the UI.
 */
export async function parseUpload(
  uploadId: string,
  opts: ParseOptions = {},
): Promise<UploadParseSummary> {
  const upload = await fetchUpload(uploadId);
  if (!upload) throw new Error(`Upload ${uploadId} not found or deleted`);

  await markProcessing(uploadId);
  try {
    if (!opts.isFirstRun) await wipeDerivedRows(uploadId);

    const buffer = await downloadFile(upload.file_path);
    const summary = await parseUploadBuffer(buffer, {
      uploadId,
      payWeek: upload.pay_week,
      cutoffDate: upload.cutoff_date,
    });

    await finalizeUpload(uploadId, summary);
    return summary;
  } catch (err) {
    await markFailed(uploadId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

// ── Implementation ───────────────────────────────────────────────────────────

interface ParseCtx {
  uploadId: string;
  payWeek: string | null;
  cutoffDate: string;
}

interface RawRow {
  rowNumber: number;
  raw: Record<string, unknown>;
  contract_id: string;
  customer_name: string | null;
  plan_name: string;
  je_badge: string;
  marketing_channel: string | null;
  je_disposition: string | null;
  contract_signed_date: string | null;
  kwh_or_rce: number | null;
  commission_type: string | null;
  /** Always non-negative. Original sign is preserved in raw_row.Total. */
  je_paid_amount: number;
  /** True when the source Total/Amount was < 0 (sign-stripped above). */
  is_negative: boolean;
  raw_term_months: number | null;
  notes: string | null;
}

async function parseUploadBuffer(
  buffer: Buffer,
  ctx: ParseCtx,
): Promise<UploadParseSummary> {
  const workbook = new ExcelJS.Workbook();
  // exceljs's bundled typings declare `Buffer` without a generic param, which
  // resolves to `Buffer<ArrayBuffer>` (concrete) under @types/node 20+, while
  // ours is `Buffer<ArrayBufferLike>` (wider). The runtime payload is
  // identical, so we narrow via the exceljs parameter type to keep TS happy.
  type ExcelLoadArg = Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(buffer as unknown as ExcelLoadArg);

  const sheet = workbook.getWorksheet(COMMISSIONS_SHEET_NAME);
  if (!sheet) {
    throw new Error(`No se encontró la hoja "${COMMISSIONS_SHEET_NAME}" en el archivo.`);
  }

  // Find header row (first row with at least one mapped column).
  const headerInfo = findHeaderRow(sheet);
  if (!headerInfo) {
    throw new Error('No se pudo identificar la fila de encabezados.');
  }

  const summary: UploadParseSummary = {
    uploadId: ctx.uploadId,
    totalRows: 0,
    insertedSales: 0,
    insertedBonuses: 0,
    insertedResiduals: 0,
    errors: 0,
    byStatus: {
      PAYABLE: 0,
      PAYABLE_NEXT_WEEK: 0,
      CHARGEBACK: 0,
      CANCELLED: 0,
      VERIFY: 0,
      WINBACK: 0,
    },
    winbackCount: 0,
    cancelledByChargebackCount: 0,
    badgeAlertsCount: 0,
    verifyPlans: [],
  };

  const verifyPlansSet = new Set<string>();
  const badgeAlerts = new Map<string, number>(); // je_badge → count

  const lastRow = sheet.actualRowCount;
  for (let rowIdx = headerInfo.rowNumber + 1; rowIdx <= lastRow; rowIdx++) {
    const excelRow = sheet.getRow(rowIdx);
    if (isBlankRow(excelRow, headerInfo.columnIndex)) continue;

    summary.totalRows += 1;

    let parsed: RawRow;
    try {
      parsed = readRow(excelRow, headerInfo, rowIdx);
    } catch (err) {
      await recordRowError(ctx.uploadId, rowIdx, null, err);
      summary.errors += 1;
      continue;
    }

    try {
      await processRow(parsed, ctx, summary, verifyPlansSet, badgeAlerts);
    } catch (err) {
      await recordRowError(ctx.uploadId, rowIdx, parsed.raw, err);
      summary.errors += 1;
    }
  }

  await upsertBadgeAlerts(badgeAlerts, summary);

  summary.verifyPlans = Array.from(verifyPlansSet).sort();
  return summary;
}

// ── Header detection ─────────────────────────────────────────────────────────

interface HeaderInfo {
  rowNumber: number;
  /** logical-key → 1-based column index */
  columnIndex: Map<string, number>;
}

function findHeaderRow(sheet: ExcelJS.Worksheet): HeaderInfo | null {
  const maxSearch = Math.min(sheet.actualRowCount, 10);
  for (let r = 1; r <= maxSearch; r++) {
    const row = sheet.getRow(r);
    const idx = buildHeaderIndex(row);
    // Accept a row as headers if at least three of the critical fields are
    // found. Manual rows have empty contract_id/plan_name/je_badge cells, so
    // we lean on the column structure (headers themselves) rather than any
    // single data column being present.
    const critical = ['contract_id', 'plan_name', 'je_badge', 'je_paid_amount', 'commission_type'];
    const hits = critical.filter((k) => idx.has(k)).length;
    if (hits >= 3) return { rowNumber: r, columnIndex: idx };
  }
  return null;
}

function buildHeaderIndex(row: ExcelJS.Row): Map<string, number> {
  const present = new Map<string, number>();
  row.eachCell({ includeEmpty: false }, (cell, colIdx) => {
    const norm = normalizeHeader(cell.value);
    if (norm && !present.has(norm)) present.set(norm, colIdx);
  });
  return resolveHeaderIndex(present);
}

function isBlankRow(row: ExcelJS.Row, idx: Map<string, number>): boolean {
  const contractCol = idx.get('contract_id');
  const planCol = idx.get('plan_name');
  if (!contractCol && !planCol) return false;
  const contract = contractCol ? cellString(row.getCell(contractCol)) : '';
  const plan = planCol ? cellString(row.getCell(planCol)) : '';
  return !contract && !plan;
}

// ── Row reading ──────────────────────────────────────────────────────────────

function readRow(row: ExcelJS.Row, header: HeaderInfo, rowNumber: number): RawRow {
  const idx = header.columnIndex;

  // raw_row is keyed by the human-readable header text so the audit/debug
  // view in the Pendientes detail makes sense.
  const headerNames = new Map<number, string>();
  row.worksheet.getRow(header.rowNumber).eachCell({ includeEmpty: false }, (cell, colIdx) => {
    headerNames.set(colIdx, String(cell.value ?? '').trim());
  });
  const raw: Record<string, unknown> = {};
  row.eachCell({ includeEmpty: false }, (cell, colIdx) => {
    const name = headerNames.get(colIdx) || `col_${colIdx}`;
    raw[name] = cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : cell.value;
  });

  const contract_id = readString(row, idx.get('contract_id'));
  const plan_name = readString(row, idx.get('plan_name'));
  const je_badge = readString(row, idx.get('je_badge'));
  const commission_type = readString(row, idx.get('commission_type')) || null;
  const rawAmount = readNumber(row, idx.get('je_paid_amount')) ?? 0;
  const rawTerm = readInt(row, idx.get('term'));

  // Manual rows have no contract_id, no plan_name, no badge — that's expected
  // and they go to company_bonuses, not payroll_sales. Defer validation to
  // processRow() so it can branch by row type.
  const manual = isManualBonusRow(commission_type);
  if (!manual) {
    if (!contract_id) throw new Error('Contract ID vacío.');
    if (!plan_name) throw new Error('Plan Name vacío.');
    if (!je_badge) throw new Error('Agent Badge Number vacío.');
  }

  return {
    rowNumber,
    raw,
    contract_id,
    plan_name,
    je_badge,
    customer_name: readString(row, idx.get('customer_name')) || null,
    marketing_channel: readString(row, idx.get('marketing_channel')) || null,
    je_disposition: readString(row, idx.get('je_disposition')) || null,
    contract_signed_date: readDate(row, idx.get('contract_signed_date')),
    kwh_or_rce: readNumber(row, idx.get('kwh_or_rce')),
    commission_type,
    je_paid_amount: Math.abs(rawAmount),
    is_negative: rawAmount < 0,
    // JE writes 0 in the Term column for Manual-type rows; the DB CHECK
    // requires BETWEEN 1 AND 120, so coerce 0 to NULL.
    raw_term_months: rawTerm && rawTerm > 0 ? rawTerm : null,
    notes: readString(row, idx.get('notes')) || null,
  };
}

function cellString(cell: ExcelJS.Cell): string {
  const v = cell?.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    // ExcelJS rich text / hyperlink / formula result
    if ('text' in v && typeof (v as { text: unknown }).text === 'string') {
      return (v as { text: string }).text.trim();
    }
    if ('result' in v) {
      const r = (v as { result: unknown }).result;
      return r == null ? '' : String(r).trim();
    }
    if (v instanceof Date) return v.toISOString();
  }
  return String(v).trim();
}

function readString(row: ExcelJS.Row, colIdx: number | undefined): string {
  if (!colIdx) return '';
  return cellString(row.getCell(colIdx));
}

function readNumber(row: ExcelJS.Row, colIdx: number | undefined): number | null {
  if (!colIdx) return null;
  const v = row.getCell(colIdx).value;
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v !== null && 'result' in v) {
    const r = (v as { result: unknown }).result;
    if (typeof r === 'number') return r;
  }
  // Strip currency symbols and commas.
  const s = String(v).replace(/[$,\s]/g, '').replace(/[()]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function readInt(row: ExcelJS.Row, colIdx: number | undefined): number | null {
  const n = readNumber(row, colIdx);
  if (n == null) return null;
  const i = Math.round(n);
  return Number.isFinite(i) ? i : null;
}

function readDate(row: ExcelJS.Row, colIdx: number | undefined): string | null {
  if (!colIdx) return null;
  const v = row.getCell(colIdx).value;
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    // Excel serial date (days since 1899-12-30; 1900 leap-year bug accounted for).
    const ms = (v - 25569) * 86400 * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (typeof v === 'object' && v !== null && 'result' in v) {
    const r = (v as { result: unknown }).result;
    if (r instanceof Date) return r.toISOString().slice(0, 10);
  }
  const parsed = new Date(String(v));
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

// ── Per-row processing ───────────────────────────────────────────────────────

async function processRow(
  parsed: RawRow,
  ctx: ParseCtx,
  summary: UploadParseSummary,
  verifyPlansSet: Set<string>,
  badgeAlerts: Map<string, number>,
): Promise<void> {
  // ── Manual bonus path: detected by Commission Type, not by plan_mapping. ──
  // Manual rows have no plan_name and no agent badge; they're company-level
  // payouts (e.g. "Back to Business Incentive Week 15"). They go straight
  // to company_bonuses.
  if (isManualBonusRow(parsed.commission_type)) {
    await insertManualBonus(parsed, ctx);
    summary.insertedBonuses += 1;
    return;
  }

  const mapping = await resolvePlanMapping(parsed.plan_name);
  const internalAgentId = await resolveBadge(parsed.je_badge);
  if (!internalAgentId) {
    badgeAlerts.set(parsed.je_badge, (badgeAlerts.get(parsed.je_badge) ?? 0) + 1);
  }

  // ── Classify status. ───────────────────────────────────────────────────────
  // Chargeback signal: Total < 0 OR Commission Type === 'Correction'. We can
  // detect a chargeback even when plan_name has no mapping yet — the row
  // still belongs to the chargeback bucket and shouldn't sit in VERIFY.
  const isChargeback = isChargebackRow(
    parsed.is_negative ? -parsed.je_paid_amount : parsed.je_paid_amount,
    parsed.commission_type,
  );

  let status: SaleStatus;
  let payWeekForRow: string | null = null;

  if (isChargeback) {
    status = 'CHARGEBACK';
    payWeekForRow = ctx.payWeek;
  } else if (!mapping) {
    status = 'VERIFY';
    verifyPlansSet.add(parsed.plan_name);
  } else if (mapping.plan_type === 'COMMISSION') {
    const cutoff = ctx.cutoffDate;
    const signed = parsed.contract_signed_date;
    if (signed && cutoff && signed > cutoff) {
      status = 'PAYABLE_NEXT_WEEK';
      payWeekForRow = ctx.payWeek ? addDays(ctx.payWeek, 7) : null;
    } else {
      status = 'PAYABLE';
      payWeekForRow = ctx.payWeek;
    }
  } else {
    // Adders, residuals, green bonus — current-week PAYABLE.
    status = defaultStatusForPlanType(mapping.plan_type);
    payWeekForRow = ctx.payWeek;
  }

  // ── Duplicate handling against prior payroll_sales rows. ──────────────────
  const duplicateAction = await reconcileDuplicates(
    parsed.contract_id,
    parsed.plan_name,
    status,
    summary,
  );

  if (duplicateAction.skipInsert) {
    // The prior row was updated in place; we never created a new sale row.
    summary.byStatus[duplicateAction.finalStatus] += 1;
    return;
  }

  const isWinback =
    status === 'PAYABLE' && (await isWinbackContract(parsed.contract_id));
  if (isWinback) summary.winbackCount += 1;

  // Block 08: when a row is the comeback after a prior chargeback, promote
  // its status to WINBACK so the UI / downstream calc can distinguish a
  // freshly-paid contract from a back-to-back winback without inspecting
  // a separate flag. is_winback stays TRUE for backwards compatibility.
  const effectiveStatus: SaleStatus = isWinback ? 'WINBACK' : status;

  // Block 05 — resolve tier/term up front so the row lands fully classified.
  // Both functions return null when they don't apply (Retail, adders, etc.).
  const assignedTier = resolveTierForSale({ plan_mapping_id: mapping?.id ?? null }, mapping);
  const termResolution = resolveTermMonthsForSale(
    { raw_term_months: parsed.raw_term_months },
    mapping,
  );

  // ── Insert payroll_sales row. ──────────────────────────────────────────────
  const insert: Record<string, unknown> = {
    upload_id: ctx.uploadId,
    source_file_name: '', // patched below
    contract_id: parsed.contract_id,
    customer_name: parsed.customer_name,
    plan_name: parsed.plan_name,
    plan_mapping_id: mapping?.id ?? null,
    je_badge: parsed.je_badge,
    marketing_channel: parsed.marketing_channel,
    je_disposition: parsed.je_disposition,
    contract_signed_date: parsed.contract_signed_date,
    kwh_or_rce: parsed.kwh_or_rce,
    commission_type: parsed.commission_type,
    je_paid_amount: parsed.je_paid_amount,
    status: effectiveStatus,
    internal_agent_id: internalAgentId,
    pay_week: payWeekForRow,
    raw_term_months: parsed.raw_term_months,
    assigned_tier: assignedTier,
    assigned_term_months: termResolution.value,
    is_winback: isWinback,
    raw_row: parsed.raw,
  };
  insert.source_file_name = await getSourceFileName(ctx.uploadId);

  const { data: saleData, error: saleErr } = await supabase
    .from('payroll_sales')
    .insert(insert)
    .select('id')
    .single();
  if (saleErr) throw new Error(`Insert payroll_sales falló: ${saleErr.message}`);
  summary.insertedSales += 1;
  summary.byStatus[effectiveStatus] += 1;

  // ── Side-effects: RCE adders and residuals. ────────────────────────────────
  // Fire for live PAYABLE and WINBACK rows. A chargeback of an RCE adder
  // is just a negative payroll_sales row — creating a positive
  // company_bonuses entry for it would double-reverse. Block 11 nets the
  // chargeback against the original bonus when computing the weekly payfile.
  const sideEffectsAllowed = effectiveStatus === 'PAYABLE' || effectiveStatus === 'WINBACK';
  if (sideEffectsAllowed && mapping && (mapping.plan_type === 'RCE_ADDER_D2D' || mapping.plan_type === 'RCE_ADDER_RETAIL')) {
    await insertCompanyBonus(parsed, saleData!.id, mapping.plan_type, ctx.payWeek);
    summary.insertedBonuses += 1;
  } else if (sideEffectsAllowed && mapping && (mapping.plan_type === 'RESIDUAL_D2D' || mapping.plan_type === 'GREEN_BONUS')) {
    await insertResidual(parsed, saleData!.id, mapping.plan_type, ctx.payWeek);
    summary.insertedResiduals += 1;
  }
}

// ── DB helpers ───────────────────────────────────────────────────────────────

async function fetchUpload(uploadId: string) {
  const { data, error } = await supabase
    .from('payroll_uploads')
    .select('id, file_path, file_name, cutoff_date, pay_week, deleted_at')
    .eq('id', uploadId)
    .maybeSingle();
  if (error) throw new Error(`fetchUpload: ${error.message}`);
  if (!data || data.deleted_at) return null;
  return data as {
    id: string;
    file_path: string;
    file_name: string;
    cutoff_date: string;
    pay_week: string | null;
    deleted_at: string | null;
  };
}

async function downloadFile(filePath: string): Promise<Buffer> {
  const client = getSupabase();
  const { data, error } = await client.storage.from(STORAGE_BUCKET).download(filePath);
  if (error || !data) throw new Error(`Storage download falló: ${error?.message ?? 'sin datos'}`);
  const arrayBuf = await data.arrayBuffer();
  return Buffer.from(arrayBuf);
}

async function markProcessing(uploadId: string) {
  await supabase
    .from('payroll_uploads')
    .update({ processing_status: 'PROCESSING' })
    .eq('id', uploadId);
}

async function markFailed(uploadId: string, message: string) {
  await supabase
    .from('payroll_uploads')
    .update({
      processing_status: 'FAILED',
      processed: false,
      notes: message.slice(0, 1000),
    })
    .eq('id', uploadId);
}

async function finalizeUpload(uploadId: string, summary: UploadParseSummary) {
  const status =
    summary.errors === 0 && summary.totalRows > 0 ? 'PROCESSED'
    : summary.errors > 0 && summary.insertedSales + summary.insertedBonuses + summary.insertedResiduals > 0 ? 'PARTIAL'
    : summary.totalRows === 0 ? 'PROCESSED'
    : 'FAILED';
  await supabase
    .from('payroll_uploads')
    .update({
      processing_status: status,
      processed: status !== 'FAILED',
      row_count: summary.totalRows,
      error_count: summary.errors,
      processed_at: new Date().toISOString(),
    })
    .eq('id', uploadId);
}

async function wipeDerivedRows(uploadId: string) {
  // Delete in FK-safe order. company_bonuses + residuals link via source_sale_id,
  // so we delete them first using the source sales we're about to remove.
  const { data: saleIds } = await supabase
    .from('payroll_sales')
    .select('id')
    .eq('upload_id', uploadId);
  const ids = (saleIds ?? []).map((r) => r.id);

  if (ids.length > 0) {
    await supabase.from('company_bonuses').delete().in('source_sale_id', ids);
    await supabase.from('residuals').delete().in('source_sale_id', ids);
  }
  // Manual bonuses (no source_sale_id) — we tag them in original_je_data.
  await supabase
    .from('company_bonuses')
    .delete()
    .is('source_sale_id', null)
    .eq('original_je_data->>upload_id', uploadId);

  await supabase.from('payroll_sales').delete().eq('upload_id', uploadId);
  await supabase.from('payroll_upload_row_errors').delete().eq('upload_id', uploadId);
}

async function getSourceFileName(uploadId: string): Promise<string> {
  const { data } = await supabase
    .from('payroll_uploads')
    .select('file_name')
    .eq('id', uploadId)
    .single();
  return data?.file_name ?? '';
}

async function resolveBadge(jeBadge: string): Promise<string | null> {
  const { data } = await supabase
    .from('payroll_roster')
    .select('user_id')
    .eq('je_badge', jeBadge)
    .eq('je_badge_status', 'active')
    .maybeSingle();
  return data?.user_id ?? null;
}

// ── Duplicate / chargeback reconciliation ────────────────────────────────────

interface ReconcileResult {
  skipInsert: boolean;
  finalStatus: SaleStatus;
}

async function reconcileDuplicates(
  contractId: string,
  planName: string,
  newStatus: SaleStatus,
  summary: UploadParseSummary,
): Promise<ReconcileResult> {
  // We only reconcile against *active* prior rows. CANCELLED/CHARGEBACK rows
  // are historical and don't block a new insert.
  const { data: priors } = await supabase
    .from('payroll_sales')
    .select('id, status, plan_name, pay_week')
    .eq('contract_id', contractId)
    .in('status', ['PAYABLE', 'PAYABLE_NEXT_WEEK']);

  const matches = (priors ?? []) as Array<{ id: string; status: SaleStatus; plan_name: string; pay_week: string | null }>;

  if (matches.length === 0) {
    return { skipInsert: false, finalStatus: newStatus };
  }

  // CHARGEBACK incoming → cancel all matching priors (by contract_id), then
  // insert the new CHARGEBACK row.
  if (newStatus === 'CHARGEBACK') {
    for (const m of matches) {
      const { error } = await supabase
        .from('payroll_sales')
        .update({ status: 'CANCELLED', notes: 'PAYABLE/CHARGEBACK' })
        .eq('id', m.id);
      if (!error) summary.cancelledByChargebackCount += 1;
    }
    return { skipInsert: false, finalStatus: 'CHARGEBACK' };
  }

  // PAYABLE incoming + prior PAYABLE_NEXT_WEEK with same plan_name → promote
  // the prior row in place instead of inserting a duplicate.
  if (newStatus === 'PAYABLE') {
    const sameNextWeek = matches.find(
      (m) => m.status === 'PAYABLE_NEXT_WEEK' && m.plan_name === planName,
    );
    if (sameNextWeek) {
      await supabase
        .from('payroll_sales')
        .update({ status: 'PAYABLE' })
        .eq('id', sameNextWeek.id);
      return { skipInsert: true, finalStatus: 'PAYABLE' };
    }
  }

  return { skipInsert: false, finalStatus: newStatus };
}

async function isWinbackContract(contractId: string): Promise<boolean> {
  const { data } = await supabase
    .from('payroll_sales')
    .select('id')
    .eq('contract_id', contractId)
    .eq('status', 'CHARGEBACK')
    .limit(1);
  return (data?.length ?? 0) > 0;
}

// ── Side-table inserts ───────────────────────────────────────────────────────

async function insertCompanyBonus(
  parsed: RawRow,
  saleId: string,
  bonusType: 'RCE_ADDER_D2D' | 'RCE_ADDER_RETAIL',
  payWeek: string | null,
) {
  if (!payWeek) return; // Skip if no pay_week assigned yet (VERIFY pass-through).
  const { error } = await supabase.from('company_bonuses').insert({
    source_sale_id: saleId,
    bonus_type: bonusType,
    original_je_data: parsed.raw,
    total_amount: parsed.je_paid_amount,
    description: parsed.plan_name,
    pay_week: payWeek,
  });
  if (error) throw new Error(`Insert company_bonuses falló: ${error.message}`);
}

async function insertResidual(
  parsed: RawRow,
  saleId: string,
  residualType: 'RESIDUAL_D2D' | 'GREEN_BONUS',
  payWeek: string | null,
) {
  if (!payWeek) return;
  const { error } = await supabase.from('residuals').insert({
    source_sale_id: saleId,
    residual_type: residualType,
    amount: parsed.je_paid_amount,
    pay_week: payWeek,
    original_je_data: parsed.raw,
  });
  if (error) throw new Error(`Insert residuals falló: ${error.message}`);
}

async function insertManualBonus(parsed: RawRow, ctx: ParseCtx) {
  if (!ctx.payWeek) return;
  // Manual bonuses live in company_bonuses with source_sale_id = NULL. We
  // tag the upload_id in original_je_data so wipeDerivedRows can find them.
  // Description: prefer the JE Notes field ("Watts Homewater" / "Back to
  // Business Incentive Week 15"); fall back to the plan_name or a generic
  // label if both are absent.
  const description =
    parsed.notes?.trim()
    || parsed.plan_name
    || (parsed.contract_id ? `Bono manual ${parsed.contract_id}` : 'Bono manual');
  const meta = { ...parsed.raw, upload_id: ctx.uploadId };
  const { error } = await supabase.from('company_bonuses').insert({
    source_sale_id: null,
    bonus_type: 'MANUAL_BONUS',
    original_je_data: meta,
    total_amount: parsed.je_paid_amount,
    description,
    pay_week: ctx.payWeek,
  });
  if (error) throw new Error(`Insert manual bonus falló: ${error.message}`);
}

// ── Badge alerts ─────────────────────────────────────────────────────────────

async function upsertBadgeAlerts(
  badgeAlerts: Map<string, number>,
  summary: UploadParseSummary,
) {
  if (badgeAlerts.size === 0) return;
  const nowIso = new Date().toISOString();
  for (const [badge, count] of badgeAlerts) {
    // Upsert with sale_count increment. We can't atomically increment a column
    // via supabase-js without an RPC; read-then-write is acceptable here
    // (one upload at a time, no race).
    const { data: existing } = await supabase
      .from('je_badge_alerts')
      .select('id, sale_count')
      .eq('je_badge', badge)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('je_badge_alerts')
        .update({
          sale_count: existing.sale_count + count,
          last_seen_at: nowIso,
          resolved_at: null, // re-open if it had been resolved
          resolved_by: null,
        })
        .eq('id', existing.id);
    } else {
      const { error } = await supabase.from('je_badge_alerts').insert({
        je_badge: badge,
        sale_count: count,
      });
      if (!error) summary.badgeAlertsCount += 1;
    }
  }
}

// ── Row error reporting ──────────────────────────────────────────────────────

async function recordRowError(
  uploadId: string,
  rowNumber: number,
  rawRow: Record<string, unknown> | null,
  err: unknown,
) {
  const message = err instanceof Error ? err.message : String(err);
  await supabase.from('payroll_upload_row_errors').insert({
    upload_id: uploadId,
    row_number: rowNumber,
    raw_row: rawRow,
    error_message: message.slice(0, 1000),
  });
}

// ── Test surface (unit-test hook only — not used by production code) ─────────
export const __testing = {
  findHeaderRow,
  buildHeaderIndex,
  readRow,
  parseUploadBuffer,
} satisfies Record<string, unknown>;

export type { PlanMapping };
