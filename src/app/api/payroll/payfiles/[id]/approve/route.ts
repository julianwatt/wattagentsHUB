import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { approveAndPublish } from '@/lib/payroll/payfileTransitions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RouteCtx { params: Promise<{ id: string }> }

/**
 * POST /api/payroll/payfiles/[id]/approve
 *
 * PENDING_APPROVAL → APPROVED → PUBLISHED. CEO only. Atomic-ish:
 *   1. Flip state to APPROVED.
 *   2. createPayfileSnapshot (block 07) — generates the immutable
 *      snapshot row + PDF + Storage upload.
 *   3. Flip state to PUBLISHED.
 *   4. Push notification to the recipient.
 * If step 2 fails, state rolls back to PENDING_APPROVAL.
 */
export async function POST(_req: NextRequest, ctx: RouteCtx) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'ceo') {
    return NextResponse.json({ error: 'Solo el CEO puede aprobar.' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const result = await approveAndPublish(id, { user_id: session.user.id, role: 'ceo' });
  if (!result.ok) {
    const status = result.error === 'gate_failed' ? 422 : 400;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}
