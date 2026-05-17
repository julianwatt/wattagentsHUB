import { NextRequest, NextResponse } from 'next/server';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { createPayfileSnapshot } from '@/lib/payroll/publishPayfile';
import { canPublishPayfile } from '@/lib/payroll/canPublishPayfile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/payroll/payfiles/[id]/snapshot
 *
 * Creates a new payfile_versions row + uploads the PDF. Does NOT change
 * payfile.state — that's block 11's job. Useful for previewing the final
 * artifact before the real publish flow lands.
 *
 * Gated by canPublishPayfile (VERIFY rows + 3× rule).
 */
export async function POST(_req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;

  const gate = await canPublishPayfile(id);
  if (!gate.ok) {
    return NextResponse.json(
      { error: 'gate_failed', gate },
      { status: 422 },
    );
  }

  try {
    const result = await createPayfileSnapshot(id, session.user.id);
    return NextResponse.json({
      version: result.version,
      pdf_path: result.pdf_path,
      bytes: result.bytes,
    }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `snapshot falló: ${msg}` }, { status: 500 });
  }
}

