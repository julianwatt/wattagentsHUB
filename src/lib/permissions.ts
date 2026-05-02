/**
 * Centralized role-based permission helpers.
 *
 * Each helper is the single source of truth for a feature's access rules.
 * Adding a new role (e.g. Manager) to a feature requires changing exactly
 * one line — the array in the helper itself.
 */

export type AppRole = 'agent' | 'jr_manager' | 'sr_manager' | 'admin' | 'ceo';

/**
 * Roles allowed to manage assignments (create, view all, cancel, see live
 * activity, see history).
 *
 * 👉 FUTURE: when Managers (`jr_manager` / `sr_manager`) gain assignment
 * management for their own team, add them to this array. The API routes
 * will additionally need to scope queries to the manager's team — that
 * scoping logic goes in the API, NOT here. This array is purely about
 * "can this role see/access the Asignaciones section at all".
 */
const ASSIGNMENTS_ROLES: readonly AppRole[] = ['admin', 'ceo'];

export function canManageAssignments(role: string | null | undefined): boolean {
  return !!role && (ASSIGNMENTS_ROLES as readonly string[]).includes(role);
}

/**
 * Roles that have the agent-side "Asignaciones" section showing their own
 * assignment history + live cards + personal stats.
 *
 * Includes managers because the CEO can now assign shifts to them too —
 * they need to see and act on their own assignments. The section is
 * always self-scoped by session.user.id, so the same API endpoints
 * serve all roles without changes.
 */
const OWN_PERFORMANCE_ROLES: readonly AppRole[] = ['agent', 'jr_manager', 'sr_manager'];

export function canSeeOwnPerformance(role: string | null | undefined): boolean {
  return !!role && (OWN_PERFORMANCE_ROLES as readonly string[]).includes(role);
}
