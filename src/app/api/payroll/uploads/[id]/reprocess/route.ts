import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { parseUpload } from '@/lib/payroll/parseUpload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/payroll/uploads/[id]/reprocess
 *
 * Wipes the upload's derived rows and re-runs the parser. Use cases:
 *   - First parse FAILED and admin fixed the underlying issue (e.g. mapped
 *     a missing plan, fixed a badge, etc.).
 *   - Admin edited a row in the source file and re-uploaded it via the
 *     "forced replacement" path of POST /api/payroll/uploads (which calls
 *     this internally).
 *   - Block-03 plan-mapping change already covered the VERIFY → real
 *     transition for already-inserted rows, so reprocess is mostly for the
 *     "parse failed midway" case.
 */
export async function POST(_req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;

  const { data: upload } = await supabase
    .from('payroll_uploads')
    .select('id, deleted_at')
    .eq('id', id)
    .maybeSingle();
  if (!upload) return NextResponse.json({ error: 'Upload no encontrado.' }, { status: 404 });
  if (upload.deleted_at) {
    return NextResponse.json({ error: 'Upload eliminado, no se puede reprocesar.' }, { status: 410 });
  }

  try {
    const summary = await parseUpload(id);
    await supabase.from('payroll_audit_log').insert({
      entity_type: 'payroll_upload',
      entity_id: id,
      action: 'UPDATE',
      actor_id: session.user.id,
      change_notes: `Reprocesado: ${summary.totalRows} filas, ${summary.errors} errores`,
    });
    return NextResponse.json({ summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Reprocess falló: ${message}` }, { status: 500 });
  }
}
