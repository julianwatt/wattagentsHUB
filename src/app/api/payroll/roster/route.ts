import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requirePayrollAdmin } from '@/lib/payroll/auth';
import type { PayrollRosterEntry, RosterCustomRate } from '@/types/payroll';

/**
 * GET /api/payroll/roster
 *
 * Returns one row per user that should appear in the Payroll → Roster tab:
 *   - core identity (id, name, username, role, manager_id, payroll_status, modality, hire_date)
 *   - all JE badges currently registered to that user (active + inactive history)
 *   - all custom rates currently registered to that user
 *
 * The block 04 sales-processing flow will use the badges to resolve
 * je_badge → user_id. Block 06 (commission calc) will read custom rates.
 */
export async function GET() {
  const session = await requirePayrollAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // We need every user that participates in payroll (i.e. not just agents —
  // managers and CEO can have badges too if JE assigned them one). Returning
  // every user keeps the admin-side Roster tab consistent with the existing
  // users table; the UI filters out admin/CEO from edit flows where it makes
  // sense.
  const { data: users, error: usersErr } = await supabase
    .from('users')
    .select('id, name, username, role, manager_id, modality, payroll_status, is_active, hire_date')
    .order('name', { ascending: true });
  if (usersErr) return NextResponse.json({ error: usersErr.message }, { status: 500 });

  const userIds = (users ?? []).map((u) => u.id);
  if (userIds.length === 0) return NextResponse.json([]);

  const [{ data: badges, error: badgesErr }, { data: rates, error: ratesErr }] = await Promise.all([
    supabase
      .from('payroll_roster')
      .select('id, user_id, je_badge, je_badge_status, valid_from, valid_until, campaign, position, direct_manager_id, notes, created_at, updated_at')
      .in('user_id', userIds)
      .order('valid_from', { ascending: false }),
    supabase
      .from('roster_custom_rates')
      .select('id, user_id, campaign, tier, term_months, commission_amount, override_amount, valid_from, valid_until, created_by, created_at')
      .in('user_id', userIds)
      .order('valid_from', { ascending: false }),
  ]);
  if (badgesErr) return NextResponse.json({ error: badgesErr.message }, { status: 500 });
  if (ratesErr) return NextResponse.json({ error: ratesErr.message }, { status: 500 });

  const badgesByUser = new Map<string, PayrollRosterEntry[]>();
  for (const b of (badges ?? []) as PayrollRosterEntry[]) {
    const arr = badgesByUser.get(b.user_id) ?? [];
    arr.push(b);
    badgesByUser.set(b.user_id, arr);
  }
  const ratesByUser = new Map<string, RosterCustomRate[]>();
  for (const r of (rates ?? []) as RosterCustomRate[]) {
    const arr = ratesByUser.get(r.user_id) ?? [];
    arr.push(r);
    ratesByUser.set(r.user_id, arr);
  }

  return NextResponse.json(
    (users ?? []).map((u) => ({
      ...u,
      badges: badgesByUser.get(u.id) ?? [],
      custom_rates: ratesByUser.get(u.id) ?? [],
    })),
  );
}
