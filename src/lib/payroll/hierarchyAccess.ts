/**
 * Block 13 — manager-of-team access + override privacy.
 * ============================================================================
 *
 * The "Mi Equipo" sub-tab and the team-viewing variant of getPayfileForUser
 * both depend on the same access primitives:
 *
 *   - getDownlineUserIds(viewerId)
 *       BFS over payroll_roster.direct_manager_id across every active
 *       roster row that points up to the viewer. Returns the set of
 *       user_ids underneath them at any depth. Capped at 5 hops to
 *       survive bad data.
 *
 *   - canViewPayfileAs(viewer, owner)
 *       Admin / CEO see anyone; the owner sees themselves; sr / jr
 *       managers see anyone in their downline. Everyone else gets
 *       false.
 *
 *   - filterOverridesForViewer(viewer, payfile, overrides, downline)
 *       Implements the override-privacy rules from block 13 spec §4:
 *         · admin / CEO  → no filter
 *         · self-view    → only manager_id = viewer.user_id
 *         · team-view    → only manager_id ∈ { viewer ∪ downline }
 *
 *   - buildTeamTree(viewerId, payWeek)
 *       Hierarchical payload for the Mi Equipo tab. Sr managers get
 *       { jr_managers: [...], direct_agents: [...] }; jr managers get
 *       a flat direct_agents list (no jr_managers branch).
 *
 * Server-side only.
 */

import { supabase } from '@/lib/supabase';

// ── getDownlineUserIds ──────────────────────────────────────────────────────

export async function getDownlineUserIds(managerUserId: string): Promise<Set<string>> {
  const out = new Set<string>();
  let frontier = [managerUserId];

  for (let depth = 0; depth < 5 && frontier.length > 0; depth++) {
    const { data } = await supabase
      .from('payroll_roster')
      .select('user_id')
      .in('direct_manager_id', frontier)
      .eq('je_badge_status', 'active');
    const fresh = Array.from(new Set(
      ((data ?? []) as Array<{ user_id: string }>)
        .map((r) => r.user_id)
        .filter((id) => id !== managerUserId && !out.has(id)),
    ));
    fresh.forEach((id) => out.add(id));
    frontier = fresh;
  }

  return out;
}

// ── canViewPayfileAs ────────────────────────────────────────────────────────

export interface ViewerLike {
  user_id: string;
  role: string;
}

/**
 * Owner-side check. Pre-computed downline can be passed to skip the BFS
 * (the team APIs already build it once per request).
 */
export async function canViewPayfileAs(
  viewer: ViewerLike,
  payfileOwnerId: string,
  precomputedDownline?: Set<string>,
): Promise<boolean> {
  if (viewer.role === 'admin' || viewer.role === 'ceo') return true;
  if (payfileOwnerId === viewer.user_id) return true;
  if (viewer.role === 'jr_manager' || viewer.role === 'sr_manager') {
    const downline = precomputedDownline ?? (await getDownlineUserIds(viewer.user_id));
    return downline.has(payfileOwnerId);
  }
  return false;
}

// ── filterOverridesForViewer ────────────────────────────────────────────────

export interface OverrideLike { manager_id: string }

export function filterOverridesForViewer<T extends OverrideLike>(
  viewer: ViewerLike,
  payfileOwnerId: string,
  overrides: T[],
  downline: Set<string>,
): T[] {
  if (viewer.role === 'admin' || viewer.role === 'ceo') return overrides;
  // Self-view: only my own overrides.
  if (payfileOwnerId === viewer.user_id) {
    return overrides.filter((o) => o.manager_id === viewer.user_id);
  }
  // Team-view: viewer + their downline. Horizontal peers stay hidden.
  const allowed = new Set<string>([viewer.user_id, ...downline]);
  return overrides.filter((o) => allowed.has(o.manager_id));
}

// ── buildTeamTree ───────────────────────────────────────────────────────────

export interface TeamMember {
  user: { id: string; name: string; role: string };
  payfile: {
    id: string;
    pay_week: string;
    state: string;
    total_amount: number;
    last_version_number: number;
    had_negative_balance: boolean;
  } | null;
  /** Count of PAYABLE / WINBACK source sales this week (for the table). */
  sales_count: number;
}

export interface JrBranch {
  user: { id: string; name: string; role: string };
  payfile: TeamMember['payfile'];
  sales_count: number;
  agents: TeamMember[];
}

export interface TeamTree {
  viewer_role: 'jr_manager' | 'sr_manager';
  pay_week: string;
  jr_managers: JrBranch[];
  direct_agents: TeamMember[];
  flat: TeamMember[];
  totals: {
    team_total: number;
    sales_count: number;
    member_count: number;
  };
}

export async function buildTeamTree(
  viewerId: string,
  viewerRole: 'jr_manager' | 'sr_manager',
  payWeek: string,
): Promise<TeamTree> {
  // 1. Direct reports of the viewer (across all campaigns).
  const { data: directRows } = await supabase
    .from('payroll_roster')
    .select('user_id')
    .eq('direct_manager_id', viewerId)
    .eq('je_badge_status', 'active');
  const directIds = Array.from(new Set(((directRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)));

  // 2. Hydrate user info for direct reports.
  const { data: directUsers } = directIds.length
    ? await supabase.from('users').select('id, name, role').in('id', directIds)
    : { data: [] };
  type U = { id: string; name: string; role: string };
  const userById = new Map<string, U>(((directUsers ?? []) as U[]).map((u) => [u.id, u]));

  // 3. Split direct reports by role.
  const directJrIds = directIds.filter((id) => userById.get(id)?.role === 'jr_manager');
  const directAgentIds = directIds.filter((id) => userById.get(id)?.role === 'agent');

  // 4. For Sr Manager: agents under each Jr Manager.
  let agentsUnderJr = new Map<string, string[]>();
  let allTeamIds = new Set<string>(directIds);
  if (viewerRole === 'sr_manager' && directJrIds.length > 0) {
    const { data: jrChildren } = await supabase
      .from('payroll_roster')
      .select('user_id, direct_manager_id')
      .in('direct_manager_id', directJrIds)
      .eq('je_badge_status', 'active');
    for (const row of ((jrChildren ?? []) as Array<{ user_id: string; direct_manager_id: string }>)) {
      const arr = agentsUnderJr.get(row.direct_manager_id) ?? [];
      if (!arr.includes(row.user_id)) arr.push(row.user_id);
      agentsUnderJr.set(row.direct_manager_id, arr);
      allTeamIds.add(row.user_id);
    }
  } else {
    agentsUnderJr = new Map();
  }

  // 5. Hydrate any additional users we picked up via Jr children.
  const missingIds = Array.from(allTeamIds).filter((id) => !userById.has(id));
  if (missingIds.length > 0) {
    const { data: more } = await supabase.from('users').select('id, name, role').in('id', missingIds);
    for (const u of (more ?? []) as U[]) userById.set(u.id, u);
  }

  // 6. Pull payfiles for all team members for this pay_week.
  const teamIdList = Array.from(allTeamIds);
  const { data: payfiles } = teamIdList.length
    ? await supabase
        .from('payfiles')
        .select('id, user_id, pay_week, state, total_amount, last_version_number, had_negative_balance, published_at')
        .in('user_id', teamIdList)
        .eq('pay_week', payWeek)
        .order('published_at', { ascending: false, nullsFirst: false })
    : { data: [] };
  // Keep the freshest per user (in case multiple weird rows).
  const pfByUser = new Map<string, NonNullable<TeamMember['payfile']>>();
  for (const pf of (payfiles ?? []) as Array<NonNullable<TeamMember['payfile']> & { user_id: string }>) {
    if (!pfByUser.has(pf.user_id)) {
      const { user_id: _omit, ...rest } = pf;
      void _omit;
      pfByUser.set(pf.user_id, rest as NonNullable<TeamMember['payfile']>);
    }
  }

  // 7. Pull sales counts per member for this week (PAYABLE + WINBACK only).
  const { data: salesRows } = teamIdList.length
    ? await supabase
        .from('payroll_sales')
        .select('internal_agent_id')
        .in('internal_agent_id', teamIdList)
        .eq('pay_week', payWeek)
        .in('status', ['PAYABLE', 'WINBACK'])
    : { data: [] };
  const salesCountByUser = new Map<string, number>();
  for (const s of (salesRows ?? []) as Array<{ internal_agent_id: string }>) {
    salesCountByUser.set(s.internal_agent_id, (salesCountByUser.get(s.internal_agent_id) ?? 0) + 1);
  }

  function makeMember(uid: string): TeamMember {
    const u = userById.get(uid);
    return {
      user: u ?? { id: uid, name: uid, role: 'unknown' },
      payfile: pfByUser.get(uid) ?? null,
      sales_count: salesCountByUser.get(uid) ?? 0,
    };
  }

  const jr_managers: JrBranch[] = directJrIds.map((jrId) => {
    const u = userById.get(jrId) ?? { id: jrId, name: jrId, role: 'jr_manager' };
    const agentIds = agentsUnderJr.get(jrId) ?? [];
    return {
      user: u,
      payfile: pfByUser.get(jrId) ?? null,
      sales_count: salesCountByUser.get(jrId) ?? 0,
      agents: agentIds.map(makeMember),
    };
  });
  const direct_agents = directAgentIds.map(makeMember);

  // Flat view = jr_managers themselves + their agents + direct_agents.
  const flat: TeamMember[] = [];
  for (const jr of jr_managers) {
    flat.push({ user: jr.user, payfile: jr.payfile, sales_count: jr.sales_count });
    flat.push(...jr.agents);
  }
  flat.push(...direct_agents);

  const teamTotal = flat.reduce((acc, m) => acc + Number(m.payfile?.total_amount ?? 0), 0);
  const totalSales = flat.reduce((acc, m) => acc + m.sales_count, 0);

  return {
    viewer_role: viewerRole,
    pay_week: payWeek,
    jr_managers,
    direct_agents,
    flat,
    totals: {
      team_total: teamTotal,
      sales_count: totalSales,
      member_count: flat.length,
    },
  };
}
