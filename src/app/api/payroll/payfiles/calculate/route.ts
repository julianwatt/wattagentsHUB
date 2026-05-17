import { NextRequest, NextResponse } from 'next/server';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import { calculatePayrollForWeek } from '@/lib/payroll/calculatePayfile';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/payroll/payfiles/calculate?pay_week=YYYY-MM-DD
 *
 * Synchronous orchestrator run. Wipes auto-generated payfile rows for
 * the week and recomputes from current sales + rates. Manual edits and
 * manual additions survive.
 */
export async function POST(req: NextRequest) {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payWeek = new URL(req.url).searchParams.get('pay_week') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payWeek)) {
    return NextResponse.json({ error: 'pay_week inválido (YYYY-MM-DD).' }, { status: 400 });
  }

  try {
    const result = await calculatePayrollForWeek(payWeek);
    await supabase.from('payroll_audit_log').insert({
      entity_type: 'payfile_calc',
      entity_id: '00000000-0000-0000-0000-000000000000',
      action: 'UPDATE',
      actor_id: session.user.id,
      new_value: {
        pay_week: payWeek,
        payfiles_generated: result.payfiles_generated,
        total_line_items: result.total_line_items,
        total_overrides: result.total_overrides,
        negative_balances_created: result.negative_balances_created,
      },
      change_notes: `Recalc semana ${payWeek}`,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `calc falló: ${message}` }, { status: 500 });
  }
}
