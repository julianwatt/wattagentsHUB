import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteCtx { params: Promise<{ id: string }> }

/**
 * PATCH /api/payroll/residuals/[id]
 *
 * Body: { notes?: string }
 * Only the admin-editable notes column is mutable. amount / pay_week /
 * source_sale_id come from the JE file and stay immutable.
 */
export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json();
  const patch: Record<string, unknown> = {};
  if (typeof body.notes === 'string') patch.notes = body.notes;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Sin cambios.' }, { status: 400 });

  const { data: before } = await supabase.from('residuals').select('*').eq('id', id).maybeSingle();
  if (!before) return NextResponse.json({ error: 'Residual no encontrado.' }, { status: 404 });

  const { error } = await supabase.from('residuals').update(patch).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('payroll_audit_log').insert({
    entity_type: 'residual',
    entity_id: id,
    action: 'UPDATE',
    actor_id: session.user.id,
    old_value: before,
    new_value: patch,
  });
  return NextResponse.json({ ok: true });
}
