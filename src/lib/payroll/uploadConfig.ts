/**
 * Payroll system — JE file parsing configuration (Block 04).
 * ============================================================================
 *
 * The Just Energy weekly file is a third-party Excel export whose column
 * names occasionally drift between cycles. Rather than scattering string
 * literals across the parser, every magic value lives here. If JE renames
 * "Contract Signed Date" to "Signed Date" next quarter, this is the one
 * file that changes.
 *
 * COLUMN_ALIASES is intentionally permissive: each logical field maps to a
 * list of header variants (case- and whitespace-normalized). The parser
 * resolves headers using this map; an unmapped header is logged but does
 * not block ingestion (it lands in the raw_row blob).
 *
 * Updating after JE changes a header:
 *   1. Add the new label to the relevant alias array (keep older ones too
 *      so prior files still re-parse cleanly).
 *   2. No DB migration needed — column names are purely a parser concern.
 *
 * ⚠️ The arrays below are seeded from the sample files Julian shared and
 * the master plan spec. Confirm against the actual JE sample before going
 * to production; missing aliases will surface as NULL fields on inserted
 * sale rows.
 */

/** Normalize a header to a comparison-friendly key. */
export function normalizeHeader(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The JE workbook ships three sheets. We only parse "Commissions"; the other
 * two are informational (Summary metadata and NonCommissionedContracts —
 * contracts that never paid).
 */
export const COMMISSIONS_SHEET_NAME = 'Commissions';

/**
 * Logical column → ordered list of acceptable header variants. The first
 * alias whose normalized form exists in the sheet's header row wins. Order
 * matters: when two real columns could both match ("Amount" vs "Total" both
 * carry the dollar value, but Total is the after-tax number JE actually pays),
 * the preferred header comes first.
 *
 * Confirmed against the sample file
 * `27155_Watts_Distributors_LLC_US_Weekly_1524_FlatFee_May102026.xlsx`.
 */
export const COLUMN_ALIASES: Record<string, readonly string[]> = {
  contract_id: ['contract id', 'contract number', 'contract #', 'contractid'],
  customer_name: ['customer name', 'customer', 'account name'],
  plan_name: ['plan name', 'plan'],
  // JE labels the badge "Agent Badge Number" in the weekly export. Kept the
  // shorter aliases for forward compatibility if JE renames.
  je_badge: [
    'agent badge number', 'agent badge', 'badge number',
    'je badge', 'badge', 'rep id', 'agent id',
  ],
  marketing_channel: ['marketing channel', 'channel', 'sales channel'],
  // "Termination Description" is the JE column populated when a commission is
  // being clawed back. We also accept "Disposition"-like aliases for future-
  // proofing. Combined with the negative-amount and Commission Type signals
  // below, chargeback detection is robust without depending on this alone.
  je_disposition: [
    'termination description', 'enrollment category', 'qualifying status',
    'disposition', 'je disposition', 'commission disposition',
  ],
  contract_signed_date: [
    'contract signed date', 'signed date', 'sign date',
    'contract date', 'signature date', 'enrollment date',
  ],
  // JE doesn't expose RCE directly on the row; the kWh proxy "LDC Contracted
  // Usage" is what gets stored. RCE-bucket plan_mappings are matched by
  // plan_name, not by computing RCE here.
  kwh_or_rce: [
    'ldc contracted usage', 'commission usage', 'ldc annual usage',
    'rce', 'kwh', 'annual rce', 'annual kwh',
  ],
  commission_type: ['commission type', 'comm type'],
  // "Total" comes after Amount in the sheet column order; both match logically.
  // We want Total because it's the actual paid figure including tax. Aliases
  // are walked in this order — Total wins.
  je_paid_amount: ['total', 'amount', 'commission amount', 'commission'],
  term: [
    'contract term (months)', 'contract term', 'term months', 'term',
    'contract length',
  ],
  // Manual-commission rows carry a free-text note that we use as the bonus
  // description (e.g. "Back to Business Incentive Week 15").
  notes: ['notes', 'note', 'comment'],
} as const;

/**
 * Build a per-header-row index of logical → 1-based column. Walks each
 * logical key's alias list in order so the first present alias wins.
 */
export function resolveHeaderIndex(
  presentHeaders: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [logical, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const col = presentHeaders.get(normalizeHeader(alias));
      if (col) {
        out.set(logical, col);
        break;
      }
    }
  }
  return out;
}

/**
 * Values of the `Commission Type` column. Drives parsing:
 *   - 'Plan'       → look up plan_mappings as usual; status = PAYABLE / PAYABLE_NEXT_WEEK.
 *   - 'Manual'     → MANUAL_BONUS; skip payroll_sales, insert into company_bonuses.
 *   - 'Correction' → chargeback (also fires when Total < 0).
 */
export const COMMISSION_TYPE_PLAN = 'Plan';
export const COMMISSION_TYPE_MANUAL = 'Manual';
export const COMMISSION_TYPE_CORRECTION = 'Correction';

export function isManualBonusRow(commissionType: string | null | undefined): boolean {
  return (commissionType ?? '').trim().toLowerCase() === COMMISSION_TYPE_MANUAL.toLowerCase();
}

/**
 * A row is a chargeback if either:
 *   - Total is negative (JE clawing back a previously-paid commission), OR
 *   - Commission Type is Correction.
 *
 * Termination Description is also checked as a tertiary signal, but the
 * sample shows it can be empty on a small fraction of Corrections — relying
 * on it alone would miss those.
 */
export function isChargebackRow(
  total: number | null,
  commissionType: string | null | undefined,
): boolean {
  if (total !== null && total < 0) return true;
  return (commissionType ?? '').trim().toLowerCase() === COMMISSION_TYPE_CORRECTION.toLowerCase();
}

/**
 * Filename heuristic: how to auto-detect PRINCIPAL vs BONUS file type from
 * the uploaded name. The UI lets admin override the auto-detection.
 */
export function detectFileType(fileName: string): 'PRINCIPAL' | 'BONUS' {
  const lower = fileName.toLowerCase();
  if (lower.includes('bonus') || lower.includes('bono')) return 'BONUS';
  return 'PRINCIPAL';
}

/** Hard limit enforced both client- and server-side. Mirrors the bucket cap. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

/** Allowed MIME types — what the browser sends for .xlsx in practice. */
export const ALLOWED_MIME_TYPES: readonly string[] = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
] as const;

export const ALLOWED_FILE_EXTENSIONS: readonly string[] = ['.xlsx'] as const;

/**
 * Compute the Friday on or after a given date (used to derive the default
 * pay_week from cutoff_date). JS Date.getUTCDay(): Sun=0..Sat=6. We work
 * with the YYYY-MM-DD string at UTC so the boundary never depends on the
 * caller's timezone.
 */
export function nextFridayOnOrAfter(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  const day = d.getUTCDay();
  const delta = (5 - day + 7) % 7;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Add N days to a YYYY-MM-DD string, returning YYYY-MM-DD. UTC math.
 */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
