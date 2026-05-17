import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { canAccessPayrollAdmin } from '@/lib/payroll/permissions';
import { republish } from '@/lib/payroll/payfileTransitions';
import { calculatePayfileDiffSinceLastVersion } from '@/lib/payroll/payfileDiff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RouteCtx { params: Promise<{ id: string }> }

/**
 * GET  /api/payroll/payfiles/[id]/republish  → returns the diff preview so
 *                                              the UI can show "this will
 *                                              publish directly" vs
 *                                              "needs CEO approval".
 * POST /api/payroll/payfiles/[id]/republish  → executes if diff is within
 *                                              the threshold. Otherwise the
 *                                              spec says refuse and force
 *                                              the user through submit.
 *
 * Admin or CEO.
 */
export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessPayrollAdmin(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const diff = await calculatePayfileDiffSinceLastVersion(id);
  return NextResponse.json({ diff });
}

export async function POST(_req: NextRequest, ctx: RouteCtx) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessPayrollAdmin(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const result = await republish(id, { user_id: session.user.id, role: session.user.role ?? 'admin' });
  if (!result.ok) {
    const status = result.error === 'gate_failed' ? 422 : 400;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}
