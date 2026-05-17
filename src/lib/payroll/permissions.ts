/**
 * Payroll system — server-side authorization helpers.
 * ============================================================================
 *
 * Project convention (see supabase/migrations/20260416_rls_lockdown.sql
 * and 20260502_assignment_system.sql): the server uses
 * SUPABASE_SERVICE_ROLE_KEY which bypasses RLS. All real authorization
 * lives in API routes and is enforced by these helpers, not by Postgres
 * row-level security.
 *
 * The master plan describes role-based RLS with auth.uid() and SECURITY
 * DEFINER functions; that approach does NOT fit this codebase because
 * authentication is NextAuth (custom users table + bcrypt), not Supabase
 * Auth — there is no auth.uid() available to RLS policies.
 *
 * Roles are the same as src/lib/permissions.ts:
 *   'agent' | 'jr_manager' | 'sr_manager' | 'admin' | 'ceo'
 *
 * Manager scoping (who-sees-whose payfile) will be filled in by blocks
 * 02 and 13 — those need the roster + direct_manager_id graph to walk.
 * For block 01 we only commit the top-level helpers; deeper traversal
 * helpers will be added as the manager-view block needs them.
 */

import type { AppRole } from '@/lib/permissions';

/**
 * Roles that can access the Payroll admin section (uploads, plan mapping,
 * roster, approvals, audit log, etc.).
 *
 * Currently Admin + CEO. The master plan keeps managers out of this section
 * entirely — they consume payfiles through "Mis Pagos" with the override-
 * privacy rules applied (block 13).
 */
const PAYROLL_ADMIN_ROLES: readonly AppRole[] = ['admin', 'ceo'];

export function canAccessPayrollAdmin(role: string | null | undefined): boolean {
  return !!role && (PAYROLL_ADMIN_ROLES as readonly string[]).includes(role);
}

/**
 * Roles that can finalize a payfile (move PENDING_APPROVAL → APPROVED).
 * CEO only. Admin can edit and submit for approval, but cannot self-approve.
 */
const PAYFILE_APPROVAL_ROLES: readonly AppRole[] = ['ceo'];

export function canApprovePayfile(role: string | null | undefined): boolean {
  return !!role && (PAYFILE_APPROVAL_ROLES as readonly string[]).includes(role);
}

/**
 * Roles that have a "Mis Pagos" section showing their own published payfile.
 * Includes managers because they receive override payfiles as well.
 */
const MY_PAY_ROLES: readonly AppRole[] = [
  'agent', 'jr_manager', 'sr_manager', 'admin', 'ceo',
];

export function canSeeOwnPay(role: string | null | undefined): boolean {
  return !!role && (MY_PAY_ROLES as readonly string[]).includes(role);
}

/**
 * Whether the role is allowed to see *team* payfiles (their direct and/or
 * indirect reports). Jr Managers see direct only; Sr Managers see both.
 *
 * Actual team-scoping (which users' payfiles a given manager may read) is
 * computed at query time by walking payroll_roster.direct_manager_id — that
 * helper will land in block 13 alongside the manager view UI.
 */
const TEAM_PAY_ROLES: readonly AppRole[] = ['jr_manager', 'sr_manager'];

export function canSeeTeamPay(role: string | null | undefined): boolean {
  return !!role && (TEAM_PAY_ROLES as readonly string[]).includes(role);
}
