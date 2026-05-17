import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { canAccessPayrollAdmin } from '@/lib/payroll/permissions';
import { reopen } from '@/lib/payroll/payfileTransitions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteCtx { params: Promise<{ id: string }> }

/**
 * POST /api/payroll/payfiles/[id]/reopen
 *
 * PUBLISHED → DRAFT. Admin or CEO. Body: { reason?: string }.
 * The version history stays intact; a future republish creates v(N+1).
 */
export async function POST(req: NextRequest, ctx: RouteCtx) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessPayrollAdmin(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const reason = String(body.reason ?? '').trim();
  const result = await reopen(id, { user_id: session.user.id, role: session.user.role ?? 'admin' }, reason);
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
