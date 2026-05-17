import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { createCollection } from '@/lib/payroll/collections';
import type { CollectionStatus } from '@/lib/payroll/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/payroll/collections
 *
 * Query params:
 *   debtor_id, beneficiary_id, status (csv), from, to (start_week range)
 *
 * Returns rows + hydrated debtor + beneficiary + next pending installment.
 */
export async function GET(req: NextRequest) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const debtorId = url.searchParams.get('debtor_id');
  const beneficiaryId = url.searchParams.get('beneficiary_id');
  const statusParam = url.searchParams.get('status');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  let q = supabase
    .from('collections')
    .select('*')
    .order('created_at', { ascending: false });
  if (debtorId) q = q.eq('debtor_id', debtorId);
  if (beneficiaryId) q = q.eq('beneficiary_id', beneficiaryId);
  if (statusParam) {
    const list = statusParam.split(',').map((s) => s.trim()).filter(Boolean) as CollectionStatus[];
    if (list.length > 0) q = q.in('status', list);
  }
  if (from) q = q.gte('start_week', from);
  if (to) q = q.lte('start_week', to);

  const { data: collections, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const collectionIds = (collections ?? []).map((c) => c.id);
  if (collectionIds.length === 0) {
    return NextResponse.json({ rows: [] });
  }

  // Pull users for hydration.
  const userIds = Array.from(new Set(
    (collections ?? []).flatMap((c) => [c.debtor_id, c.beneficiary_id]).filter(Boolean),
  ));
  const { data: users } = await supabase
    .from('users')
    .select('id, name, role, payroll_status')
    .in('id', userIds);
  const userById = new Map((users ?? []).map((u) => [u.id, u]));

  // Pull installments grouped per collection (for counts + next pending).
  const { data: installments } = await supabase
    .from('collection_installments')
    .select('collection_id, installment_number, scheduled_week, amount, collected_amount, status, applied_payfile_id')
    .in('collection_id', collectionIds)
    .order('installment_number', { ascending: true });

  const byCollection = new Map<string, typeof installments>();
  for (const inst of (installments ?? [])) {
    const arr = byCollection.get(inst.collection_id) ?? [];
    arr.push(inst);
    byCollection.set(inst.collection_id, arr);
  }

  return NextResponse.json({
    rows: (collections ?? []).map((c) => {
      const insts = (byCollection.get(c.id) ?? []) as Array<{
        installment_number: number; scheduled_week: string;
        amount: number; collected_amount: number; status: string;
      }>;
      const total = insts.length;
      const collected = insts.filter((i) => i.status === 'FULLY_COLLECTED').length;
      const partial = insts.find((i) => i.status === 'PARTIALLY_COLLECTED');
      const nextPending = insts.find((i) => i.status === 'PENDING' || i.status === 'PARTIALLY_COLLECTED');
      return {
        ...c,
        debtor: userById.get(c.debtor_id) ?? null,
        beneficiary: userById.get(c.beneficiary_id) ?? null,
        progress: { collected, total, partial: !!partial },
        next_pending: nextPending ?? null,
      };
    }),
  });
}

/**
 * POST /api/payroll/collections
 *
 * Body: { description, debtor_id, beneficiary_id, total_amount, installments, start_week }
 */
export async function POST(req: NextRequest) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const result = await createCollection({
    description: String(body.description ?? ''),
    debtor_id: String(body.debtor_id ?? ''),
    beneficiary_id: String(body.beneficiary_id ?? ''),
    total_amount: Number(body.total_amount ?? 0),
    installments: Number(body.installments ?? 0),
    start_week: String(body.start_week ?? ''),
    created_by: session.user.id,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, collection_id: result.collection_id }, { status: 201 });
}
