import { NextRequest, NextResponse } from 'next/server';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { distributeBono, type DistributionInput } from '@/lib/payroll/bonusDistribution';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RouteCtx { params: Promise<{ id: string }> }

/**
 * POST /api/payroll/company-bonuses/[id]/distribute
 *
 * Body: { splits: [{ recipient_id, amount, pay_week, notes? }] }
 *
 * Creates one bonus_distributions row per split, upserts the recipient's
 * payfile for that pay_week, inserts a COMPANY_BONUS line item linked
 * via source_bonus_distribution_id, and flips company_bonuses.paid_to_agents.
 *
 * Validation:
 *   - sum(splits.amount) ≤ bonus.total_amount (excess refused).
 *   - each split requires recipient_id + amount > 0 + valid pay_week.
 */
export async function POST(req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json();
  const splits = Array.isArray(body.splits) ? (body.splits as DistributionInput[]) : [];

  const result = await distributeBono({
    bonus_id: id,
    splits,
    actor_id: session.user.id,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result, { status: 201 });
}
