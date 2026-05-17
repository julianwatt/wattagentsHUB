import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';

/**
 * GET /api/payroll/badge-alerts — list every unresolved JE badge that
 * showed up in an upload without a matching payroll_roster row. The rows
 * themselves are written by block 04 (file parsing); this endpoint just
 * surfaces them so admin can either:
 *   - add the badge to an existing user (POST to /api/payroll/roster/badges,
 *     which also resolves the matching alert)
 *   - create a new user (POST /api/users, then add badge)
 */
export async function GET() {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('je_badge_alerts')
    .select('id, je_badge, first_seen_at, last_seen_at, sale_count, resolved_at, resolved_by')
    .is('resolved_at', null)
    .order('last_seen_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
