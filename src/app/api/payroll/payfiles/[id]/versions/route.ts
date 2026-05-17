import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { canPublishPayfile } from '@/lib/payroll/canPublishPayfile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/payroll/payfiles/[id]/versions
 *
 * Lists every payfile_versions row, newest first, with the publishing user
 * name hydrated. Also includes the publish-gate state so the UI can show
 * an inline "ready to snapshot" / "blocked by …" indicator without a
 * second round-trip.
 *
 * Admin/CEO only. The agent-facing version of this (latest version only,
 * scoped to self) lands in block 12.
 */
export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;

  const { data: payfile } = await supabase
    .from('payfiles')
    .select('id, user_id, pay_week, state, total_amount, last_version_number')
    .eq('id', id)
    .maybeSingle();
  if (!payfile) return NextResponse.json({ error: 'Payfile no encontrado.' }, { status: 404 });

  const { data: versions } = await supabase
    .from('payfile_versions')
    .select('id, version_number, published_at, published_by, pdf_path')
    .eq('payfile_id', id)
    .order('version_number', { ascending: false });

  const publisherIds = Array.from(new Set(
    (versions ?? []).map((v) => v.published_by).filter((id): id is string => !!id),
  ));
  const { data: publishers } = publisherIds.length
    ? await supabase.from('users').select('id, name').in('id', publisherIds)
    : { data: [] };
  const nameById = new Map((publishers ?? []).map((p) => [p.id as string, p.name as string]));

  const gate = await canPublishPayfile(id);

  return NextResponse.json({
    payfile,
    versions: (versions ?? []).map((v) => ({
      ...v,
      published_by_name: v.published_by ? nameById.get(v.published_by) ?? null : null,
    })),
    gate,
  });
}
