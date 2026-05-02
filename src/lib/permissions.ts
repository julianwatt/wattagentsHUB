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
 * Roles that have the agent-side "Mi desempeño" section showing their own
 * assignment history + personal stats.
 *
 * 👉 FUTURE: if Managers also gain a "Mi desempeño" view of their own past
 * assignments (as opposed to managing their team), add them here. Their
 * section will be self-scoped by user id, so no API changes required.
 */
const OWN_PERFORMANCE_ROLES: readonly AppRole[] = ['agent'];

export function canSeeOwnPerformance(role: string | null | undefined): boolean {
  return !!role && (OWN_PERFORMANCE_ROLES as readonly string[]).includes(role);
}
