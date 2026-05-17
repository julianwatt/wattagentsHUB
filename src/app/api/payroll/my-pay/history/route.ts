import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/payroll/my-pay/history?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Lists every PUBLISHED payfile that belongs to the caller, newest first.
 * Includes line counts and version number so the UI can show the
 * "Updated" badge (v > 1).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;
  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const minAmount = url.searchParams.get('min_amount');
  const maxAmount = url.searchParams.get('max_amount');

  let q = supabase
    .from('payfiles')
    .select('id, pay_week, total_amount, last_version_number, had_negative_balance, published_at')
    .eq('user_id', userId)
    .eq('state', 'PUBLISHED')
    .order('pay_week', { ascending: false });
  if (from) q = q.gte('pay_week', from);
  if (to) q = q.lte('pay_week', to);
  if (minAmount) q = q.gte('total_amount', Number(minAmount));
  if (maxAmount) q = q.lte('total_amount', Number(maxAmount));

  const { data: payfiles, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (payfiles ?? []).map((p) => p.id);
  const { data: lineCounts } = ids.length
    ? await supabase.from('payfile_line_items').select('payfile_id').in('payfile_id', ids)
    : { data: [] };
  const countByPf = new Map<string, number>();
  for (const li of (lineCounts ?? [])) {
    const id = (li as { payfile_id: string }).payfile_id;
    countByPf.set(id, (countByPf.get(id) ?? 0) + 1);
  }

  return NextResponse.json({
    rows: (payfiles ?? []).map((p) => ({
      ...p,
      line_count: countByPf.get(p.id) ?? 0,
      was_updated: (p.last_version_number ?? 0) > 1,
    })),
  });
}
