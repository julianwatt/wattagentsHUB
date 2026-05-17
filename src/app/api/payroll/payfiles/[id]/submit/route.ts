import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { canAccessPayrollAdmin } from '@/lib/payroll/permissions';
import { submitForApproval } from '@/lib/payroll/payfileTransitions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteCtx { params: Promise<{ id: string }> }

/**
 * POST /api/payroll/payfiles/[id]/submit
 *
 * DRAFT (or REJECTED) → PENDING_APPROVAL. Admin or CEO. Runs the
 * canPublishPayfile gate (block-05 VERIFY/tier checks + block-06 3× rule).
 */
export async function POST(_req: NextRequest, ctx: RouteCtx) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessPayrollAdmin(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const result = await submitForApproval(id, { user_id: session.user.id, role: session.user.role ?? 'admin' });
  if (!result.ok) {
    const status = result.error === 'gate_failed' ? 422 : 400;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}
