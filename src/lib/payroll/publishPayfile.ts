/**
 * Block 07 — Snapshot creation, PDF storage, regeneration helpers.
 * ============================================================================
 *
 * These functions own writes to payfile_versions + Storage. Block 11 will
 * call createPayfileSnapshot at publish time; this module is intentionally
 * decoupled from the state transition so it can be invoked from preview
 * tooling too.
 *
 * createPayfileSnapshot:
 *   1. Build the immutable PdfSnapshot view of the payfile (line items +
 *      sale detail rows). This is what gets serialised into
 *      payfile_versions.snapshot_json so future-us can rebuild the PDF
 *      identically even if the underlying data has moved on.
 *   2. version_number = (max version for this payfile) + 1, or 1.
 *   3. Render the PDF.
 *   4. Upload to payfile-pdfs/{user_id}/{pay_week}/v{N}.pdf.
 *   5. INSERT payfile_versions row pointing at the path.
 *   6. Bump payfiles.last_version_number.
 *
 * regeneratePayfilePdf:
 *   1. Load the snapshot_json from the version row.
 *   2. Render with the *current* template applied to the *frozen* data.
 *   3. Upsert into Storage (same path, overwrites).
 *   4. Audit log.
 *   Does NOT change snapshot_json, version_number, or published_at — only
 *   the visual artefact.
 *
 * Server-side only.
 */

import { supabase, getSupabase } from '@/lib/supabase';
import {
  generatePayfilePdf,
  generatePayfilePdfFromSnapshot,
  type PdfSnapshot,
} from '@/lib/payroll/pdfGenerator';
import { getPayfileForUser } from '@/lib/payroll/payfilePrivacy';
import type { PayfileVersion } from '@/types/payroll';

const PDF_BUCKET = 'payfile-pdfs';

// ── createPayfileSnapshot ───────────────────────────────────────────────────

export interface CreateSnapshotResult {
  version: PayfileVersion;
  pdf_path: string;
  bytes: number;
}

export async function createPayfileSnapshot(
  payfileId: string,
  publisherUserId: string,
): Promise<CreateSnapshotResult> {
  // We render under an Admin viewer context so the snapshot is the
  // canonical "everything" view. The download endpoint re-renders per
  // viewer when privacy needs to bite (block 13). For the stored
  // snapshot we always keep the full record.
  const publisher = { user_id: publisherUserId, role: 'admin' as const };
  const bundle = await getPayfileForUser(payfileId, publisher);
  if (!bundle) throw new Error('Payfile no encontrado.');

  // Pull the user for the snapshot header.
  const { data: user } = await supabase
    .from('users')
    .select('name, role, language')
    .eq('id', bundle.payfile.user_id)
    .single();

  // Pull sale details (block 06's join — replicated here so the snapshot
  // is self-contained).
  const saleIds = Array.from(new Set(
    bundle.line_items.map((li) => li.source_sale_id).filter((id): id is string => !!id),
  ));
  const { data: sales } = saleIds.length
    ? await supabase
        .from('payroll_sales')
        .select('id, contract_id, customer_name, plan_name, contract_signed_date')
        .in('id', saleIds)
    : { data: [] };
  type SaleRef = {
    id: string;
    contract_id: string;
    customer_name: string | null;
    plan_name: string;
    contract_signed_date: string | null;
  };
  const byId = new Map((sales ?? []).map((s) => [s.id as string, s as SaleRef]));

  // Compute next version_number safely (race-prone if two publishes hit
  // the same payfile, but block 11 will single-thread this).
  const { data: existing } = await supabase
    .from('payfile_versions')
    .select('version_number')
    .eq('payfile_id', payfileId)
    .order('version_number', { ascending: false })
    .limit(1);
  const nextVersion = ((existing ?? [])[0]?.version_number ?? 0) + 1;

  // Build the snapshot.
  const snapshot: PdfSnapshot = {
    payfile: { ...bundle.payfile, last_version_number: nextVersion },
    user: {
      name: user?.name ?? bundle.payfile.user_id,
      role: user?.role ?? '',
      language: user?.language === 'en' ? 'en' : 'es',
    },
    line_items: bundle.line_items,
    sale_details: buildSaleDetailsFromBundle(bundle.line_items, bundle.overrides, byId, user?.language ?? 'es'),
    version_number: nextVersion,
  };

  // Render + upload.
  const pdfBuffer = await generatePayfilePdfFromSnapshot(snapshot);
  const pdfPath = `${bundle.payfile.user_id}/${bundle.payfile.pay_week}/v${nextVersion}.pdf`;

  const client = getSupabase();
  const { error: upErr } = await client.storage
    .from(PDF_BUCKET)
    .upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true, // a retried snapshot at the same version overrides
    });
  if (upErr) throw new Error(`Storage upload falló: ${upErr.message}`);

  // Insert payfile_versions.
  const { data: versionRow, error: vErr } = await supabase
    .from('payfile_versions')
    .insert({
      payfile_id: payfileId,
      version_number: nextVersion,
      snapshot_json: snapshot,
      pdf_path: pdfPath,
      published_by: publisherUserId,
    })
    .select()
    .single();
  if (vErr || !versionRow) {
    // Best-effort cleanup if the DB insert failed.
    await client.storage.from(PDF_BUCKET).remove([pdfPath]);
    throw new Error(`Insert payfile_versions falló: ${vErr?.message ?? 'no data'}`);
  }

  await supabase
    .from('payfiles')
    .update({ last_version_number: nextVersion })
    .eq('id', payfileId);

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'payfile_version',
    entity_id: versionRow.id,
    action: 'CREATE',
    actor_id: publisherUserId,
    new_value: { pay_week: bundle.payfile.pay_week, version_number: nextVersion, pdf_path: pdfPath },
  });

  return { version: versionRow as PayfileVersion, pdf_path: pdfPath, bytes: pdfBuffer.byteLength };
}

// ── regeneratePayfilePdf ────────────────────────────────────────────────────

export async function regeneratePayfilePdf(
  payfileVersionId: string,
  regeneratorUserId: string,
): Promise<{ pdf_path: string; bytes: number }> {
  const { data: version } = await supabase
    .from('payfile_versions')
    .select('*')
    .eq('id', payfileVersionId)
    .maybeSingle();
  if (!version) throw new Error('Versión no encontrada.');

  const snapshot = (version as PayfileVersion).snapshot_json as unknown as PdfSnapshot;
  if (!snapshot?.payfile || !snapshot.user || !Array.isArray(snapshot.line_items)) {
    throw new Error('snapshot_json corrupto o incompleto.');
  }

  const pdfBuffer = await generatePayfilePdfFromSnapshot(snapshot);
  const pdfPath = (version as PayfileVersion).pdf_path;
  if (!pdfPath) throw new Error('La versión no tiene pdf_path.');

  const client = getSupabase();
  const { error: upErr } = await client.storage
    .from(PDF_BUCKET)
    .upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });
  if (upErr) throw new Error(`Storage overwrite falló: ${upErr.message}`);

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'payfile_version',
    entity_id: payfileVersionId,
    action: 'UPDATE',
    actor_id: regeneratorUserId,
    change_notes: 'PDF regenerado desde snapshot (template actual)',
  });

  return { pdf_path: pdfPath, bytes: pdfBuffer.byteLength };
}

// ── createSignedDownloadUrl ─────────────────────────────────────────────────

/**
 * Mints a short-lived signed URL for the version's PDF. The caller is
 * responsible for authorising access before invoking — we don't recheck
 * here.
 */
export async function createSignedDownloadUrl(
  pdfPath: string,
  ttlSeconds = 900, // 15 min
): Promise<string> {
  const client = getSupabase();
  const { data, error } = await client.storage
    .from(PDF_BUCKET)
    .createSignedUrl(pdfPath, ttlSeconds);
  if (error || !data) throw new Error(`createSignedUrl falló: ${error?.message ?? 'no data'}`);
  return data.signedUrl;
}

// ── helper used in createPayfileSnapshot ────────────────────────────────────

import { payfileLineTypeLabel } from '@/lib/payroll/labels';
import type { PayfileLineItem, PayfileOverride } from '@/types/payroll';
import type { PayfileLineType } from '@/lib/payroll/constants';
import type { SaleDetail } from '@/lib/payroll/pdfGenerator';
import type { Lang } from '@/lib/i18n';

type SaleRef = {
  id: string;
  contract_id: string;
  customer_name: string | null;
  plan_name: string;
  contract_signed_date: string | null;
};

function buildSaleDetailsFromBundle(
  lineItems: PayfileLineItem[],
  overrides: PayfileOverride[],
  byId: Map<string, SaleRef>,
  langInput: string,
): SaleDetail[] {
  const lang: Lang = langInput === 'en' ? 'en' : 'es';
  const labels = {
    es: { commission: 'Comisión', override: 'Override', bonus: 'Bono', collection: 'Cobro', adjustment: 'Ajuste' },
    en: { commission: 'Commission', override: 'Override', bonus: 'Bonus', collection: 'Collection', adjustment: 'Adjustment' },
  }[lang];

  const out: SaleDetail[] = [];
  for (const li of lineItems) {
    if (!li.source_sale_id) continue;
    const sale = byId.get(li.source_sale_id);
    if (!sale) continue;
    let paymentType = labels.adjustment;
    if (li.line_type === 'COMMISSION') paymentType = labels.commission;
    else if (li.line_type === 'OVERRIDE') {
      const ov = overrides.find((o) => o.sale_id === li.source_sale_id && o.payfile_line_item_id === li.id);
      const lvl = ov ? ov.manager_level.replace('_', ' ') : '';
      paymentType = `${labels.override}${lvl ? ` (${lvl})` : ''}`;
    } else if (li.line_type === 'COMPANY_BONUS') paymentType = labels.bonus;
    else if (li.line_type === 'COLLECTION' || li.line_type === 'NEGATIVE_BALANCE_COLLECTION') paymentType = labels.collection;
    else if (li.line_type === 'MANUAL_ADJUSTMENT') paymentType = payfileLineTypeLabel(li.line_type as PayfileLineType, lang);

    out.push({
      contract_id: sale.contract_id,
      customer_name: sale.customer_name,
      plan_name: sale.plan_name,
      contract_signed_date: sale.contract_signed_date,
      payment_type: paymentType,
      amount: Number(li.amount),
    });
  }
  return out;
}

// Re-export so this module is the single import surface for block 11 later.
export { generatePayfilePdf };
