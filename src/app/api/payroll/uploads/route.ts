import { NextRequest, NextResponse, after } from 'next/server';
import { supabase, getSupabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import {
  ALLOWED_FILE_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  detectFileType,
  nextFridayOnOrAfter,
} from '@/lib/payroll/uploadConfig';
import { parseUpload } from '@/lib/payroll/parseUpload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 300s ceiling for the background parse (Vercel Pro). The HTTP response
// itself returns in ~1–2s (Storage upload + DB insert + audit); parsing
// runs after() with the rest of the budget. Bigger files that still
// can't fit in 300s would need a real queue worker — out of scope here.
export const maxDuration = 300;

const STORAGE_BUCKET = 'payroll-uploads';

/**
 * GET /api/payroll/uploads
 *
 * Lists every non-deleted upload, newest first, with the headline counts the
 * Pendientes tab needs to render rows.
 */
export async function GET() {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('payroll_uploads')
    .select(
      'id, file_name, file_type, cutoff_date, pay_week, uploaded_at, uploaded_by, processing_status, row_count, error_count, file_size_bytes, notes',
    )
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Hydrate uploader name for the UI.
  const uploaderIds = Array.from(new Set((data ?? []).map((u) => u.uploaded_by).filter(Boolean)));
  let users: Record<string, string> = {};
  if (uploaderIds.length > 0) {
    const { data: usersData } = await supabase
      .from('users')
      .select('id, name')
      .in('id', uploaderIds);
    users = Object.fromEntries((usersData ?? []).map((u) => [u.id, u.name]));
  }

  return NextResponse.json(
    (data ?? []).map((u) => ({
      ...u,
      uploaded_by_name: users[u.uploaded_by] ?? null,
    })),
  );
}

/**
 * POST /api/payroll/uploads
 *
 * Multipart form fields:
 *   file        — required, .xlsx
 *   cutoff_date — required, YYYY-MM-DD
 *   pay_week    — optional, YYYY-MM-DD (defaults to next Friday on/after cutoff)
 *   file_type   — optional, PRINCIPAL | BONUS (auto-detected by name otherwise)
 *   notes       — optional
 *   force       — optional "1" to soft-delete a prior upload with the same name
 */
export async function POST(req: NextRequest) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file');
  const cutoffDate = (form.get('cutoff_date') as string | null)?.trim() ?? '';
  const payWeekInput = (form.get('pay_week') as string | null)?.trim() ?? '';
  const fileTypeInput = (form.get('file_type') as string | null)?.trim() ?? '';
  const notes = (form.get('notes') as string | null)?.trim() || null;
  const force = (form.get('force') as string | null) === '1';

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Archivo requerido.' }, { status: 400 });
  }
  if (!cutoffDate || !/^\d{4}-\d{2}-\d{2}$/.test(cutoffDate)) {
    return NextResponse.json({ error: 'cutoff_date inválido (use YYYY-MM-DD).' }, { status: 400 });
  }

  const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();
  if (!ALLOWED_FILE_EXTENSIONS.includes(ext)) {
    return NextResponse.json({ error: 'Sólo se permiten archivos .xlsx.' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `El archivo excede el tamaño máximo de ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.` },
      { status: 400 },
    );
  }

  const fileType =
    fileTypeInput === 'PRINCIPAL' || fileTypeInput === 'BONUS'
      ? fileTypeInput
      : detectFileType(file.name);
  const payWeek = payWeekInput && /^\d{4}-\d{2}-\d{2}$/.test(payWeekInput)
    ? payWeekInput
    : nextFridayOnOrAfter(cutoffDate);

  // Duplicate-name guard. Soft-deleted rows don't count thanks to the partial
  // unique index.
  const { data: existing } = await supabase
    .from('payroll_uploads')
    .select('id, file_name, uploaded_at, uploaded_by')
    .eq('file_name', file.name)
    .is('deleted_at', null)
    .maybeSingle();

  if (existing && !force) {
    return NextResponse.json(
      {
        error: 'duplicate_name',
        message: `Ya existe un archivo con el nombre "${file.name}".`,
        existing,
      },
      { status: 409 },
    );
  }

  if (existing && force) {
    // Soft-delete the prior upload and wipe its derived rows so a fresh
    // parse doesn't collide.
    await softDeleteUpload(existing.id, session.user.id);
  }

  // ── Upload to Storage ──────────────────────────────────────────────────────
  const year = cutoffDate.slice(0, 4);
  const filePath = `${year}/${cutoffDate}/${Date.now()}_${file.name}`;
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const client = getSupabase();
  const { error: uploadErr } = await client.storage
    .from(STORAGE_BUCKET)
    .upload(filePath, buffer, {
      contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      upsert: false,
    });
  if (uploadErr) {
    return NextResponse.json({ error: `Storage upload falló: ${uploadErr.message}` }, { status: 500 });
  }

  // ── Create payroll_uploads row ─────────────────────────────────────────────
  const { data: row, error: insertErr } = await supabase
    .from('payroll_uploads')
    .insert({
      file_name: file.name,
      file_path: filePath,
      cutoff_date: cutoffDate,
      pay_week: payWeek,
      file_type: fileType,
      uploaded_by: session.user.id,
      file_size_bytes: file.size,
      notes,
      processing_status: 'PENDING',
    })
    .select()
    .single();

  if (insertErr || !row) {
    // Roll back the Storage upload so we don't leave an orphan file.
    await client.storage.from(STORAGE_BUCKET).remove([filePath]);
    return NextResponse.json({ error: insertErr?.message ?? 'Insert falló' }, { status: 500 });
  }

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'payroll_upload',
    entity_id: row.id,
    action: 'CREATE',
    actor_id: session.user.id,
    new_value: row,
  });

  // ── Parse in background after the response returns ────────────────────────
  // Parsing a 5k-row .xlsx with side effects (sales + bonuses + residuals +
  // company_bonuses inserts, badge alerts, plan_mappings reprocess) blows
  // past Vercel's 25–60s request timeout window even though the function
  // budget allows more. after() lets the response come back immediately
  // while the parse keeps running on the same Lambda invocation up to
  // maxDuration. The UI polls payroll_uploads.processing_status to know
  // when it's done — the parser itself flips PROCESSING → PROCESSED /
  // PARTIAL / FAILED at the end.
  after(async () => {
    try {
      await parseUpload(row.id, { isFirstRun: true });
    } catch (err) {
      console.error(`[uploads POST after()] parse failed for ${row.id}:`, err);
      // parseUpload's catch block already marks the row FAILED via
      // markFailed(). Nothing else to do here.
    }
  });

  return NextResponse.json({ upload: row, summary: null }, { status: 202 });
}

async function softDeleteUpload(uploadId: string, actorId: string) {
  await supabase
    .from('payroll_uploads')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', uploadId);

  // Cascade-delete the derived rows so the same data doesn't reappear when
  // the file is re-uploaded. company_bonuses + residuals first (FK), then
  // payroll_sales, then row errors.
  const { data: saleIds } = await supabase
    .from('payroll_sales')
    .select('id')
    .eq('upload_id', uploadId);
  const ids = (saleIds ?? []).map((r) => r.id);
  if (ids.length > 0) {
    await supabase.from('company_bonuses').delete().in('source_sale_id', ids);
    await supabase.from('residuals').delete().in('source_sale_id', ids);
  }
  await supabase
    .from('company_bonuses')
    .delete()
    .is('source_sale_id', null)
    .eq('original_je_data->>upload_id', uploadId);
  await supabase.from('payroll_sales').delete().eq('upload_id', uploadId);
  await supabase.from('payroll_upload_row_errors').delete().eq('upload_id', uploadId);

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'payroll_upload',
    entity_id: uploadId,
    action: 'DELETE',
    actor_id: actorId,
    change_notes: 'Soft delete (forced replacement)',
  });
}
