import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { supabase } from '@/lib/supabase';
import { canAccessPayrollAdmin, canSeeOwnPay } from '@/lib/payroll/permissions';
import { createSignedDownloadUrl } from '@/lib/payroll/publishPayfile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/payroll/payfiles/[id]/download?version=N
 *
 * Returns a 15-minute signed URL for the version's PDF in Storage.
 *
 * Auth (block-07 surface — block 13 adds manager-of-team scoping):
 *   - Admin / CEO → always.
 *   - Owner of the payfile (the user whose payfile it is) → always.
 *   - Everyone else → 403.
 *
 * If version is omitted or "latest", we use the payfile's
 * last_version_number.
 */
export async function GET(req: NextRequest, ctx: RouteCtx) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const versionParam = new URL(req.url).searchParams.get('version');

  const { data: payfile } = await supabase
    .from('payfiles')
    .select('id, user_id, last_version_number')
    .eq('id', id)
    .maybeSingle();
  if (!payfile) return NextResponse.json({ error: 'Payfile no encontrado.' }, { status: 404 });

  const role = session.user.role ?? '';
  const isPrivileged = canAccessPayrollAdmin(role);
  const isOwner = (payfile as { user_id: string }).user_id === session.user.id;
  if (!isPrivileged && !isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (isOwner && !canSeeOwnPay(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const wanted = versionParam && versionParam !== 'latest'
    ? Number(versionParam)
    : (payfile as { last_version_number: number }).last_version_number;
  if (!wanted) {
    return NextResponse.json({ error: 'Aún no hay versiones publicadas para este payfile.' }, { status: 404 });
  }

  const { data: version } = await supabase
    .from('payfile_versions')
    .select('id, pdf_path')
    .eq('payfile_id', id)
    .eq('version_number', wanted)
    .maybeSingle();
  if (!version || !(version as { pdf_path: string | null }).pdf_path) {
    return NextResponse.json({ error: 'Versión no encontrada o sin PDF.' }, { status: 404 });
  }

  try {
    const url = await createSignedDownloadUrl((version as { pdf_path: string }).pdf_path);
    await supabase.from('payroll_audit_log').insert({
      entity_type: 'payfile_version',
      entity_id: (version as { id: string }).id,
      action: 'UPDATE',
      actor_id: session.user.id,
      change_notes: 'Signed download URL emitida (TTL 15min)',
    });
    return NextResponse.json({ url, version_number: wanted, ttl_seconds: 900 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `signed url falló: ${msg}` }, { status: 500 });
  }
}
