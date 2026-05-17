import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { reject as rejectPayfile } from '@/lib/payroll/payfileTransitions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteCtx { params: Promise<{ id: string }> }

/**
 * POST /api/payroll/payfiles/[id]/reject
 *
 * PENDING_APPROVAL → DRAFT with rejection_notes captured. CEO only.
 * Body: { notes: string } (mandatory, min 1 char after trim)
 */
export async function POST(req: NextRequest, ctx: RouteCtx) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'ceo') {
    return NextResponse.json({ error: 'Solo el CEO puede rechazar.' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const notes = String(body.notes ?? '').trim();
  const result = await rejectPayfile(id, { user_id: session.user.id, role: 'ceo' }, notes);
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
