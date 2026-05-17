import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { editCollection, cancelCollection } from '@/lib/payroll/collections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteCtx { params: Promise<{ id: string }> }

/**
 * GET /api/payroll/collections/[id]
 *
 * Detail: collection + debtor/beneficiary + every installment + the
 * payfile_line_items that ever paid each installment (collection history).
 */
export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const { data: collection } = await supabase
    .from('collections')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!collection) return NextResponse.json({ error: 'No encontrada.' }, { status: 404 });

  const { data: installments } = await supabase
    .from('collection_installments')
    .select('*')
    .eq('collection_id', id)
    .order('installment_number', { ascending: true });

  // History — every line item that referenced this collection.
  const { data: lineItems } = await supabase
    .from('payfile_line_items')
    .select('id, payfile_id, line_type, amount, created_at, payfiles!inner(pay_week, user_id, state)')
    .eq('source_collection_id', id)
    .order('created_at', { ascending: true });

  const userIds = Array.from(new Set([
    (collection as { debtor_id: string }).debtor_id,
    (collection as { beneficiary_id: string }).beneficiary_id,
  ]));
  const { data: users } = await supabase
    .from('users')
    .select('id, name, role, payroll_status')
    .in('id', userIds);
  const userById = new Map((users ?? []).map((u) => [u.id, u]));

  return NextResponse.json({
    collection,
    debtor: userById.get((collection as { debtor_id: string }).debtor_id) ?? null,
    beneficiary: userById.get((collection as { beneficiary_id: string }).beneficiary_id) ?? null,
    installments: installments ?? [],
    history: lineItems ?? [],
  });
}

/**
 * PATCH /api/payroll/collections/[id]
 *
 * Body: { description?, beneficiary_id?, installments? }
 */
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json();
  const result = await editCollection({
    id,
    actor_id: session.user.id,
    description: body.description,
    beneficiary_id: body.beneficiary_id,
    installments: body.installments,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/payroll/collections/[id]
 *
 * Body: { reason?: string }
 * Soft cancel: collection → CANCELLED, PENDING installments → CANCELLED.
 * Already-collected installments stay as-is.
 */
export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const result = await cancelCollection(id, String(body.reason ?? ''), session.user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
