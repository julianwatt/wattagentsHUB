import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';
import { getPayfileForUser } from '@/lib/payroll/payfilePrivacy';
import type { PayfileLineItem } from '@/types/payroll';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/payroll/my-pay/week?pay_week=YYYY-MM-DD&payfile_id=UUID
 *
 * Returns the bundle (payfile + line_items + overrides + sales_detail)
 * scoped to the logged-in user as viewer.
 *
 * pay_week takes priority — the API resolves to the user's published
 * payfile for that week. payfile_id is a fallback when the caller
 * already knows the id (rare).
 *
 * Block-07's payfilePrivacy.getPayfileForUser already filters the
 * overrides array to only the owner's own rows (managers don't see
 * what OTHER managers earned on the same sale).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;
  const url = new URL(req.url);
  const payWeek = url.searchParams.get('pay_week');
  const payfileIdParam = url.searchParams.get('payfile_id');

  let payfileId: string | null = payfileIdParam;
  if (!payfileId) {
    if (!payWeek || !/^\d{4}-\d{2}-\d{2}$/.test(payWeek)) {
      return NextResponse.json({ error: 'pay_week o payfile_id requerido.' }, { status: 400 });
    }
    const { data } = await supabase
      .from('payfiles')
      .select('id, state')
      .eq('user_id', userId)
      .eq('pay_week', payWeek)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (!data) return NextResponse.json({ error: 'No tienes payfile para esa semana.' }, { status: 404 });
    payfileId = (data as { id: string }).id;
  }

  const bundle = await getPayfileForUser(payfileId, {
    user_id: userId,
    role: session.user.role ?? 'agent',
  });
  if (!bundle) return NextResponse.json({ error: 'Payfile no accesible.' }, { status: 403 });

  // Only let the viewer see PUBLISHED state contents. For DRAFT /
  // PENDING_APPROVAL we tell them the admin is still working.
  if (bundle.payfile.state !== 'PUBLISHED') {
    return NextResponse.json({
      payfile_id: bundle.payfile.id,
      pay_week: bundle.payfile.pay_week,
      state: bundle.payfile.state,
      in_progress: true,
    });
  }

  // Sales detail — hydrate the source_sale_id of every PAYABLE-ish line.
  const saleIds = Array.from(new Set(
    bundle.line_items.map((li: PayfileLineItem) => li.source_sale_id).filter((id): id is string => !!id),
  ));
  const { data: sales } = saleIds.length
    ? await supabase
        .from('payroll_sales')
        .select('id, contract_id, customer_name, plan_name, contract_signed_date, is_winback, internal_agent_id')
        .in('id', saleIds)
    : { data: [] };

  // For managers viewing overrides on others' sales, include the
  // agent's display name. For agents viewing their own commissions the
  // agent_id is themselves; we still expose name for symmetry.
  const agentIds = Array.from(new Set((sales ?? []).map((s) => s.internal_agent_id).filter((id): id is string => !!id)));
  const { data: agents } = agentIds.length
    ? await supabase.from('users').select('id, name').in('id', agentIds)
    : { data: [] };
  const agentNameById = new Map((agents ?? []).map((a) => [a.id as string, a.name as string]));
  const saleById = new Map((sales ?? []).map((s) => [s.id as string, s]));

  return NextResponse.json({
    payfile: bundle.payfile,
    line_items: bundle.line_items,
    overrides: bundle.overrides,
    sales_detail: (sales ?? []).map((s) => ({
      ...s,
      agent_name: s.internal_agent_id ? agentNameById.get(s.internal_agent_id) ?? null : null,
    })),
    in_progress: false,
    // Convenience map for the UI to look up a sale by line item.
    sale_by_id: Object.fromEntries(saleById),
  });
}
