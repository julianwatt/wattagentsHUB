import { NextRequest, NextResponse } from 'next/server';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { regeneratePayfilePdf } from '@/lib/payroll/publishPayfile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/payroll/payfile-versions/[id]/regenerate
 *
 * Re-renders the PDF for an existing payfile_versions row from its
 * stored snapshot_json with the *current* template. Does NOT modify the
 * snapshot, the version_number, or any DB state — only the Storage
 * object is overwritten in place.
 *
 * Admin / CEO only.
 */
export async function POST(_req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  try {
    const result = await regeneratePayfilePdf(id, session.user.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `regeneración falló: ${msg}` }, { status: 500 });
  }
}
