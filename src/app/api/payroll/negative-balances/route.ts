import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { NEGATIVE_BALANCE_STATUSES, type NegativeBalanceStatus, type NegativeBalanceOrigin, type RosterCampaign } from '@/lib/payroll/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/payroll/negative-balances
 *
 * Query params (all optional):
 *   user_id     — filter to one user
 *   status      — comma-separated NegativeBalanceStatus list
 *   origin      — COMMISSION | OVERRIDE
 *   campaign    — D2D | RETAIL
 *   from / to   — origin_week range, YYYY-MM-DD
 *
 * Returns rows + hydrated user (name, role, payroll_status). Admin/CEO only.
 */
export async function GET(req: NextRequest) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const userId = url.searchParams.get('user_id') || null;
  const statusParam = url.searchParams.get('status') || '';
  const origin = url.searchParams.get('origin') || null;
  const campaign = url.searchParams.get('campaign') || null;
  const from = url.searchParams.get('from') || null;
  const to = url.searchParams.get('to') || null;

  let q = supabase
    .from('negative_balances')
    .select('*')
    .order('origin_week', { ascending: false })
    .order('created_at', { ascending: false });

  if (userId) q = q.eq('user_id', userId);
  if (origin) q = q.eq('origin', origin as NegativeBalanceOrigin);
  if (campaign) q = q.eq('campaign', campaign as RosterCampaign);
  if (from) q = q.gte('origin_week', from);
  if (to) q = q.lte('origin_week', to);
  if (statusParam) {
    const list = statusParam.split(',').map((s) => s.trim()).filter((s) => (NEGATIVE_BALANCE_STATUSES as readonly string[]).includes(s));
    if (list.length > 0) q = q.in('status', list as NegativeBalanceStatus[]);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const userIds = Array.from(new Set((data ?? []).map((r) => r.user_id).filter(Boolean)));
  const { data: users } = userIds.length
    ? await supabase.from('users').select('id, name, role, payroll_status').in('id', userIds)
    : { data: [] };
  const userMap = new Map((users ?? []).map((u) => [u.id, u]));

  return NextResponse.json({
    rows: (data ?? []).map((r) => ({
      ...r,
      user: userMap.get(r.user_id) ?? null,
    })),
  });
}
