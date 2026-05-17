import { NextRequest, NextResponse } from 'next/server';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { editDistribution, deleteDistribution } from '@/lib/payroll/bonusDistribution';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteCtx { params: Promise<{ id: string }> }

/**
 * PATCH /api/payroll/bonus-distributions/[id]
 *
 * Body: { amount?, pay_week?, notes? }
 * Refuses when the linked payfile is past DRAFT/REJECTED.
 */
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json();
  const result = await editDistribution({
    id,
    actor_id: session.user.id,
    amount: typeof body.amount === 'number' ? body.amount : undefined,
    pay_week: typeof body.pay_week === 'string' ? body.pay_week : undefined,
    notes: body.notes,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/payroll/bonus-distributions/[id]
 *
 * Same payfile-state guard. Audit log captures the removal.
 */
export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const result = await deleteDistribution(id, session.user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
