import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';
import { getDownlineUserIds } from '@/lib/payroll/hierarchyAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/payroll/my-pay/team/weeks
 *
 * Distinct pay_weeks where ANY team member (downline) has a payfile.
 * Drives the week selector in the "Mi Equipo" tab.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user.role ?? '';
  if (role !== 'jr_manager' && role !== 'sr_manager') {
    return NextResponse.json({ error: 'Esta vista es sólo para managers.' }, { status: 403 });
  }

  const downline = await getDownlineUserIds(session.user.id);
  if (downline.size === 0) return NextResponse.json([]);

  const { data } = await supabase
    .from('payfiles')
    .select('pay_week')
    .in('user_id', Array.from(downline))
    .order('pay_week', { ascending: false });
  const weeks = Array.from(new Set((data ?? []).map((r) => r.pay_week as string)));
  return NextResponse.json(weeks);
}
