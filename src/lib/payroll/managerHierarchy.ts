/**
 * Block 06 — Manager hierarchy resolution.
 * ============================================================================
 *
 * Walks `payroll_roster.direct_manager_id` from an agent up to three levels
 * and slots each ancestor into the right MANAGER_* bucket *by position*,
 * not by walk depth. The master plan defines:
 *   MANAGER_1 = sr_manager (highest)
 *   MANAGER_2 = jr_manager (middle)
 *   MANAGER_3 = jr_jr_manager (closest; no such role today, slot stays NULL)
 *
 * Two real-world shapes the slotting handles cleanly:
 *   D2D today (1 level above agent):  Agent → SrMgr  →  M1 only.
 *   Retail today (2 levels above):    Agent → JrMgr → SrMgr  →  M1 + M2.
 *   Future Retail (3 levels):         Agent → JrJr → Jr → Sr →  M1 + M2 + M3.
 *
 * Campaign-scoped: a user can sit under different managers in D2D vs
 * Retail (separate roster rows per campaign). We always walk along the
 * roster row that matches the sale's campaign.
 *
 * The roster is fetched in one query per calc (RosterIndex below) and the
 * walk is in-memory — no per-sale DB round-trips.
 */

import type { RosterCampaign, RosterPosition, ManagerLevel } from '@/lib/payroll/constants';

export interface RosterRow {
  user_id: string;
  direct_manager_id: string | null;
  campaign: RosterCampaign;
  position: RosterPosition;
  je_badge_status: 'active' | 'inactive';
  valid_from: string;
  valid_until: string | null;
}

export interface HierarchySlot {
  user_id: string;
  position: RosterPosition;
}

export interface ResolvedHierarchy {
  manager_1: HierarchySlot | null;
  manager_2: HierarchySlot | null;
  manager_3: HierarchySlot | null;
}

/**
 * In-memory index of vigent roster rows. Built once per calc.
 *   key: `${user_id}|${campaign}`
 */
export type RosterIndex = Map<string, RosterRow>;

export function rosterIndexKey(userId: string, campaign: RosterCampaign): string {
  return `${userId}|${campaign}`;
}

/**
 * Slot a manager's position into the matching MANAGER_X bucket. Unknown
 * positions (e.g. a user tagged as 'admin' or 'ceo' who happens to be a
 * direct_manager) are ignored.
 */
function slotFor(position: RosterPosition): ManagerLevel | null {
  switch (position) {
    case 'sr_manager': return 'MANAGER_1';
    case 'jr_manager': return 'MANAGER_2';
    // 'jr_jr_manager' would slot to MANAGER_3 — not in ROSTER_POSITIONS today.
    default: return null;
  }
}

/**
 * Walk the roster chain campaign-scoped, slotting each ancestor by position.
 * Safety-capped at 5 hops to survive a cyclic direct_manager_id (corrupt data).
 */
export function resolveManagerHierarchy(
  agentUserId: string,
  campaign: RosterCampaign,
  rosterIndex: RosterIndex,
): ResolvedHierarchy {
  const result: ResolvedHierarchy = {
    manager_1: null,
    manager_2: null,
    manager_3: null,
  };

  const visited = new Set<string>([agentUserId]);
  let current = rosterIndex.get(rosterIndexKey(agentUserId, campaign));

  for (let hops = 0; hops < 5; hops++) {
    const nextId = current?.direct_manager_id ?? null;
    if (!nextId || visited.has(nextId)) break;
    visited.add(nextId);

    const managerRow = rosterIndex.get(rosterIndexKey(nextId, campaign));
    if (!managerRow) break; // manager has no roster row for this campaign

    const slot = slotFor(managerRow.position);
    if (slot === 'MANAGER_1' && !result.manager_1) {
      result.manager_1 = { user_id: managerRow.user_id, position: managerRow.position };
    } else if (slot === 'MANAGER_2' && !result.manager_2) {
      result.manager_2 = { user_id: managerRow.user_id, position: managerRow.position };
    } else if (slot === 'MANAGER_3' && !result.manager_3) {
      result.manager_3 = { user_id: managerRow.user_id, position: managerRow.position };
    }
    current = managerRow;
  }

  return result;
}

/**
 * Whether an override at the given level for this hierarchy should be paid
 * as DIRECT or INDIRECT. Per master plan §Override:
 *   - The CLOSEST manager to the agent (lowest non-null slot) is DIRECT.
 *   - Everyone above them is INDIRECT.
 * In D2D (M1 only), M1 is the closest → DIRECT.
 * In Retail (M1 + M2), M2 is closest → DIRECT, M1 → INDIRECT.
 * In future 3-level Retail, M3 is closest → DIRECT, M1 + M2 → INDIRECT.
 */
export function isDirectOverride(
  hierarchy: ResolvedHierarchy,
  level: ManagerLevel,
): boolean {
  if (level === 'MANAGER_3') return hierarchy.manager_3 !== null;
  if (level === 'MANAGER_2') return hierarchy.manager_2 !== null && hierarchy.manager_3 === null;
  if (level === 'MANAGER_1') return hierarchy.manager_1 !== null && hierarchy.manager_2 === null && hierarchy.manager_3 === null;
  return false;
}
