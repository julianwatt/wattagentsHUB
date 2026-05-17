import { NextRequest, NextResponse } from 'next/server';
import { supabase, getSupabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import type { SaleStatus } from '@/lib/payroll/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STORAGE_BUCKET = 'payroll-uploads';

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/payroll/uploads/[id]
 *
 * Returns the upload metadata + per-status counts + row errors. Used by the
 * file detail view.
 */
export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;

  const { data: upload, error } = await supabase
    .from('payroll_uploads')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!upload || upload.deleted_at) {
    return NextResponse.json({ error: 'Upload no encontrado.' }, { status: 404 });
  }

  // Per-status counts.
  const { data: sales } = await supabase
    .from('payroll_sales')
    .select('status, is_winback')
    .eq('upload_id', id);
  const counts: Record<SaleStatus, number> = {
    PAYABLE: 0,
    PAYABLE_NEXT_WEEK: 0,
    CHARGEBACK: 0,
    CANCELLED: 0,
    VERIFY: 0,
    WINBACK: 0,
  };
  let winback = 0;
  for (const s of (sales ?? []) as Array<{ status: SaleStatus; is_winback: boolean }>) {
    counts[s.status] = (counts[s.status] ?? 0) + 1;
    if (s.is_winback) winback += 1;
  }

  // Bonuses and residuals (joined via source_sale_id, plus the upload_id-tagged
  // manual bonuses).
  const { data: saleIds } = await supabase
    .from('payroll_sales')
    .select('id')
    .eq('upload_id', id);
  const ids = (saleIds ?? []).map((r) => r.id);

  let bonusCount = 0;
  let residualCount = 0;
  if (ids.length > 0) {
    const [{ count: bc }, { count: rc }] = await Promise.all([
      supabase
        .from('company_bonuses')
        .select('id', { count: 'exact', head: true })
        .in('source_sale_id', ids),
      supabase
        .from('residuals')
        .select('id', { count: 'exact', head: true })
        .in('source_sale_id', ids),
    ]);
    bonusCount += bc ?? 0;
    residualCount += rc ?? 0;
  }
  const { count: manualBonusCount } = await supabase
    .from('company_bonuses')
    .select('id', { count: 'exact', head: true })
    .is('source_sale_id', null)
    .eq('original_je_data->>upload_id', id);
  bonusCount += manualBonusCount ?? 0;

  // Row errors.
  const { data: rowErrors } = await supabase
    .from('payroll_upload_row_errors')
    .select('id, row_number, error_message, raw_row, created_at')
    .eq('upload_id', id)
    .order('row_number', { ascending: true });

  return NextResponse.json({
    upload,
    counts,
    winback,
    bonusCount,
    residualCount,
    rowErrors: rowErrors ?? [],
  });
}

/**
 * DELETE /api/payroll/uploads/[id]
 *
 * Soft-delete with safety: refuse if any sale row is referenced by a
 * published payfile. Optional ?force=1 from CEO bypasses (block 11 will tie
 * payfile publication to this — for block 04 there are no payfiles yet, so
 * the safety check is a no-op, but the path is wired up now).
 */
export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const force = new URL(req.url).searchParams.get('force') === '1';

  const { data: upload } = await supabase
    .from('payroll_uploads')
    .select('id, deleted_at, file_path')
    .eq('id', id)
    .maybeSingle();
  if (!upload) return NextResponse.json({ error: 'Upload no encontrado.' }, { status: 404 });
  if (upload.deleted_at) return NextResponse.json({ error: 'Ya estaba eliminado.' }, { status: 410 });

  // Block 11 will refine this — for now we check the payfile_line_items table
  // for any row sourced from a sale tied to this upload.
  const { data: lockedSales } = await supabase
    .from('payroll_sales')
    .select('id')
    .eq('upload_id', id);
  const lockedIds = (lockedSales ?? []).map((r) => r.id);
  if (lockedIds.length > 0 && !force) {
    const { data: published } = await supabase
      .from('payfile_line_items')
      .select('id, payfile_id, payfiles!inner(state)')
      .in('source_sale_id', lockedIds);
    const blockers = (published ?? []).filter(
      (r) => (r as { payfiles?: { state?: string } }).payfiles?.state === 'PUBLISHED',
    );
    if (blockers.length > 0) {
      return NextResponse.json(
        {
          error: 'has_published_payfile',
          message: `${blockers.length} ventas están en payfiles publicados. Use ?force=1 para forzar eliminación.`,
        },
        { status: 409 },
      );
    }
  }

  // Soft delete + cascade derived rows (same as the forced replacement path).
  await supabase
    .from('payroll_uploads')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (lockedIds.length > 0) {
    await supabase.from('company_bonuses').delete().in('source_sale_id', lockedIds);
    await supabase.from('residuals').delete().in('source_sale_id', lockedIds);
  }
  await supabase
    .from('company_bonuses')
    .delete()
    .is('source_sale_id', null)
    .eq('original_je_data->>upload_id', id);
  await supabase.from('payroll_sales').delete().eq('upload_id', id);
  await supabase.from('payroll_upload_row_errors').delete().eq('upload_id', id);

  // Remove the underlying Storage object so we don't carry the data around.
  if (upload.file_path) {
    const client = getSupabase();
    await client.storage.from(STORAGE_BUCKET).remove([upload.file_path]);
  }

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'payroll_upload',
    entity_id: id,
    action: 'DELETE',
    actor_id: session.user.id,
    change_notes: force ? 'Forced delete (CEO)' : 'Soft delete',
  });

  return NextResponse.json({ ok: true });
}
