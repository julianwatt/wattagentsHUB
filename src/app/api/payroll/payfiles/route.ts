import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import type { Payfile, PayfileLineItem, PayfileOverride } from '@/types/payroll';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/payroll/payfiles?pay_week=YYYY-MM-DD
 *
 * Returns every payfile + line items + override rows for a pay_week.
 * Hydrated with user name. Admin / CEO view — they see the lot. Block 13
 * will route manager / agent views through getPayfileForUser instead.
 */
export async function GET(req: NextRequest) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payWeek = new URL(req.url).searchParams.get('pay_week') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payWeek)) {
    return NextResponse.json({ error: 'pay_week inválido.' }, { status: 400 });
  }

  const { data: payfiles, error } = await supabase
    .from('payfiles')
    .select('*')
    .eq('pay_week', payWeek)
    .order('total_amount', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = ((payfiles ?? []) as Payfile[]).map((p) => p.id);
  if (ids.length === 0) {
    return NextResponse.json({ pay_week: payWeek, payfiles: [] });
  }

  const [{ data: lineItems }, { data: users }] = await Promise.all([
    supabase
      .from('payfile_line_items')
      .select('*')
      .in('payfile_id', ids)
      .order('created_at', { ascending: true }),
    supabase
      .from('users')
      .select('id, name, role')
      .in('id', ((payfiles ?? []) as Payfile[]).map((p) => p.user_id)),
  ]);

  // Pull every override row for the sales these payfiles touch.
  const saleIds = Array.from(new Set(
    ((lineItems ?? []) as PayfileLineItem[])
      .map((li) => li.source_sale_id)
      .filter((id): id is string => !!id),
  ));
  let overrides: PayfileOverride[] = [];
  if (saleIds.length > 0) {
    const { data } = await supabase
      .from('payfile_overrides')
      .select('*')
      .in('sale_id', saleIds);
    overrides = (data ?? []) as PayfileOverride[];
  }

  const userById = new Map((users ?? []).map((u) => [u.id, u]));
  const linesByPayfile = new Map<string, PayfileLineItem[]>();
  for (const li of (lineItems ?? []) as PayfileLineItem[]) {
    const arr = linesByPayfile.get(li.payfile_id) ?? [];
    arr.push(li);
    linesByPayfile.set(li.payfile_id, arr);
  }
  const overridesByPayfileOwner = new Map<string, PayfileOverride[]>();
  for (const ov of overrides) {
    const arr = overridesByPayfileOwner.get(ov.manager_id) ?? [];
    arr.push(ov);
    overridesByPayfileOwner.set(ov.manager_id, arr);
  }

  return NextResponse.json({
    pay_week: payWeek,
    payfiles: ((payfiles ?? []) as Payfile[]).map((p) => ({
      ...p,
      user: userById.get(p.user_id) ?? null,
      line_items: linesByPayfile.get(p.id) ?? [],
      overrides: overridesByPayfileOwner.get(p.user_id) ?? [],
    })),
  });
}
