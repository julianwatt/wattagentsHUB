import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/payroll/my-pay/current
 *
 * Returns the logged-in user's most recent PUBLISHED payfile. No payload
 * for users that have never had a payfile or whose latest one isn't
 * published yet.
 *
 * The response is the bare payfile metadata — the per-week detail (line
 * items, overrides scoped to the viewer, sales) comes from
 * /api/payroll/my-pay/week.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;

  // Most recent published payfile.
  const { data: payfile } = await supabase
    .from('payfiles')
    .select('id, pay_week, state, total_amount, last_version_number, had_negative_balance, published_at')
    .eq('user_id', userId)
    .eq('state', 'PUBLISHED')
    .order('pay_week', { ascending: false })
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!payfile) {
    // Surface "in progress" hint when there's a non-published payfile for
    // the current pay_week the admin's working on.
    const { data: pending } = await supabase
      .from('payfiles')
      .select('pay_week, state')
      .eq('user_id', userId)
      .neq('state', 'PUBLISHED')
      .order('pay_week', { ascending: false })
      .limit(1)
      .maybeSingle();
    return NextResponse.json({
      has_published: false,
      pending_state: pending ? (pending as { state: string }).state : null,
      pending_week: pending ? (pending as { pay_week: string }).pay_week : null,
    });
  }

  return NextResponse.json({ has_published: true, payfile });
}
