import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { approve3xLine } from '@/lib/payroll/payfileTransitions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteCtx { params: Promise<{ id: string }> }

/**
 * POST /api/payroll/payfile-line-items/[id]/approve-3x
 *
 * Clears requires_ceo_approval on a line item that exceeds 3× the source
 * sale's je_paid_amount. CEO only. Used by the per-line "Aprobar este
 * ajuste" button in the Aprobación tab.
 */
export async function POST(_req: NextRequest, ctx: RouteCtx) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'ceo') {
    return NextResponse.json({ error: 'Solo el CEO puede aprobar.' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const result = await approve3xLine(id, { user_id: session.user.id, role: 'ceo' });
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
