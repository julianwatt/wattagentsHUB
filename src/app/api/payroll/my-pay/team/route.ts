import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';
import { buildTeamTree } from '@/lib/payroll/hierarchyAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/payroll/my-pay/team?pay_week=YYYY-MM-DD
 *
 * Caller must be jr_manager or sr_manager. Returns:
 *   - jr_managers (sr_manager only): direct Jr reports + agents under each
 *   - direct_agents: agents that report directly to the viewer
 *   - flat: every team member with their payfile for that pay_week
 *   - totals: team_total / sales_count / member_count
 *
 * Distinct pay_weeks for the selector come from
 * /api/payroll/my-pay/team/weeks (sister route).
 *
 * Agents who try this endpoint get 403; admin/CEO are nudged to use the
 * full /payroll surface instead.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user.role ?? '';
  if (role !== 'jr_manager' && role !== 'sr_manager') {
    return NextResponse.json({ error: 'Esta vista es sólo para managers.' }, { status: 403 });
  }

  const payWeek = new URL(req.url).searchParams.get('pay_week') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payWeek)) {
    return NextResponse.json({ error: 'pay_week inválido (YYYY-MM-DD).' }, { status: 400 });
  }

  const tree = await buildTeamTree(session.user.id, role as 'jr_manager' | 'sr_manager', payWeek);
  return NextResponse.json(tree);
}
