/**
 * Assignment status taxonomy — single source of truth.
 * ============================================================================
 *
 * The `assignments.status` column has 9 valid values (enforced by the DB
 * CHECK constraint, see migrations 20260502_assignment_system.sql,
 * 20260502_assignments_replaced_and_punctuality.sql,
 * 20260503_assignments_cancelled_in_progress.sql):
 *
 *   pending                  Created, awaiting agent acceptance.
 *   accepted                 Agent accepted, hasn't yet entered the perimeter.
 *   in_progress              Agent inside the perimeter; effective time accumulating.
 *   completed                Shift ended naturally; expected duration met.
 *   incomplete               Shift ended naturally; expected duration NOT met
 *                            (includes auto-end by exited_final geofence event).
 *   cancelled                Cancelled by CEO/Admin BEFORE the agent arrived.
 *   cancelled_in_progress    Cancelled by CEO/Admin AFTER the agent arrived;
 *                            preserves actual_entry_at + effective_minutes.
 *   rejected                 Declined by the agent (with optional reason).
 *   replaced                 Superseded by a fresh row for the same agent+day
 *                            (only happens when a pending row is replaced via
 *                            POST /api/assignments?replace=1).
 *
 * Real life partitions these into a handful of orthogonal sets, each tied to
 * a specific operational decision. This module names every set we reason
 * about, and provides predicate helpers so call sites read like the spec
 * instead of literal status strings.
 *
 * Conventions:
 *  - All constants are `readonly string[]` (sorted for diff stability).
 *  - All helpers accept `string | null | undefined` and return false on null.
 *  - When a Supabase query needs an `.in('status', [...])` clause, pass the
 *    constant array directly — Supabase accepts readonly arrays.
 *
 * 🔗 DB sync warning: any change to LIVE_STATUSES MUST also be reflected in
 * the partial-unique index `assignments_active_unique_per_day` (see
 * 20260502_assignments_replaced_and_punctuality.sql:18-20). The two MUST
 * stay in lockstep — the index is the truth that prevents two live rows
 * for the same (agent, shift_date).
 * ============================================================================
 */

export type AssignmentStatus =
  | 'pending'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'incomplete'
  | 'cancelled'
  | 'cancelled_in_progress'
  | 'rejected'
  | 'replaced';

// ── Sets ─────────────────────────────────────────────────────────────────────

/**
 * "Live": the assignment occupies the agent's slot for this shift_date. Mirrors
 * the WHERE clause of the DB partial-unique index. Only one live row per
 * (agent_id, shift_date) is allowed at any time.
 */
export const LIVE_STATUSES: readonly AssignmentStatus[] = [
  'pending', 'accepted', 'in_progress', 'completed', 'incomplete',
];

/**
 * Subset of LIVE that hard-blocks a new POST /api/assignments for the same
 * (agent, day): the CEO must explicitly cancel one of these before they can
 * create a replacement. `pending` is intentionally excluded — that one gets
 * the soft confirmation flow (CONFIRMATION_REQUIRED_STATUSES below).
 */
export const BLOCKING_STATUSES: readonly AssignmentStatus[] = [
  'accepted', 'in_progress', 'completed', 'incomplete',
];

/**
 * "In-flight": still moving, not yet finished. Used by /api/assignments/my
 * to drive the agent's live cards (pending → accept/reject; accepted →
 * waiting to arrive; in_progress → working). Excludes the two terminal-
 * with-completion statuses (completed, incomplete) which would just be
 * historical noise on the agent's "now" view.
 *
 * = LIVE_STATUSES \ {completed, incomplete}.
 */
export const IN_FLIGHT_STATUSES: readonly AssignmentStatus[] = [
  'pending', 'accepted', 'in_progress',
];

/**
 * Statuses that require explicit confirmation (`?replace=1`) to supersede.
 * Currently just `pending` — an unaccepted row is "soft" enough that the
 * CEO is allowed to overwrite it after acknowledging the warning.
 */
export const CONFIRMATION_REQUIRED_STATUSES: readonly AssignmentStatus[] = [
  'pending',
];

/**
 * "Released": the slot is free, the historical record stays. Creating a new
 * assignment for the same (agent, day) requires NO action when an existing
 * row has one of these statuses — the partial-unique index excludes them so
 * the INSERT proceeds and the released row remains as audit history.
 */
export const RELEASED_STATUSES: readonly AssignmentStatus[] = [
  'cancelled', 'cancelled_in_progress', 'rejected', 'replaced',
];

/**
 * Terminal: no further state transitions are permitted. PATCH endpoints
 * reject any modification request that would mutate a row in this set
 * (with the narrow exception of cancel-already-cancelled idempotency).
 *
 * = BLOCKING_STATUSES (minus in_progress, which is mutable) + RELEASED_STATUSES.
 * Equivalently: every status except 'pending', 'accepted', 'in_progress'.
 */
export const TERMINAL_STATUSES: readonly AssignmentStatus[] = [
  'completed', 'incomplete',
  'cancelled', 'cancelled_in_progress', 'rejected', 'replaced',
];

/**
 * Cancellation states grouped together — used for the cancel-endpoint
 * idempotency short-circuit (re-cancelling either of these is a no-op).
 */
export const CANCELLED_STATUSES: readonly AssignmentStatus[] = [
  'cancelled', 'cancelled_in_progress',
];

/**
 * Statuses that count as "the agent's shift for this day was X" in
 * agent-facing KPIs and compliance metrics — naturally-ended shifts only
 * (no admin-cancelled rows, no in-flight, no rejected/replaced).
 *
 * NOTE: For "did the agent actually show up?" use the operational rule
 * `wasWorked(assignment)` — that one is based on `actual_entry_at !== null`
 * which captures cancelled_in_progress and in_progress rows too. The
 * IS_ACTIVE_FOR_AGENT set is a stricter, status-only filter for headline
 * counts where in-flight or admin-intervention rows shouldn't be tallied.
 */
export const IS_ACTIVE_FOR_AGENT: readonly AssignmentStatus[] = [
  'completed', 'incomplete',
];

// ── Internal lookup sets (constructed once for O(1) `has` checks) ──────────
const LIVE_SET = new Set<string>(LIVE_STATUSES);
const BLOCKING_SET = new Set<string>(BLOCKING_STATUSES);
const IN_FLIGHT_SET = new Set<string>(IN_FLIGHT_STATUSES);
const CONFIRMATION_REQUIRED_SET = new Set<string>(CONFIRMATION_REQUIRED_STATUSES);
const RELEASED_SET = new Set<string>(RELEASED_STATUSES);
const TERMINAL_SET = new Set<string>(TERMINAL_STATUSES);
const CANCELLED_SET = new Set<string>(CANCELLED_STATUSES);
const ACTIVE_FOR_AGENT_SET = new Set<string>(IS_ACTIVE_FOR_AGENT);

// ── Predicates ───────────────────────────────────────────────────────────────

/** True if the row occupies the agent's slot for the day (any LIVE status). */
export function isLive(status: string | null | undefined): boolean {
  return !!status && LIVE_SET.has(status);
}

/** True if the row hard-blocks creating a new assignment for the same slot. */
export function isBlocking(status: string | null | undefined): boolean {
  return !!status && BLOCKING_SET.has(status);
}

/** True if the row is in-flight (pending/accepted/in_progress) — still moving. */
export function isInFlight(status: string | null | undefined): boolean {
  return !!status && IN_FLIGHT_SET.has(status);
}

/** True if the row needs explicit `?replace=1` confirmation to be superseded. */
export function isConfirmationRequired(status: string | null | undefined): boolean {
  return !!status && CONFIRMATION_REQUIRED_SET.has(status);
}

/** True if the row has released the slot — a new assignment can be created. */
export function isReleased(status: string | null | undefined): boolean {
  return !!status && RELEASED_SET.has(status);
}

/** True if the row is in a terminal state (no further transitions). */
export function isTerminal(status: string | null | undefined): boolean {
  return !!status && TERMINAL_SET.has(status);
}

/** True if the row is in a cancellation state (cancelled or cancelled_in_progress). */
export function isCancelled(status: string | null | undefined): boolean {
  return !!status && CANCELLED_SET.has(status);
}

/** True if the row counts as a finished shift for the agent's KPIs. */
export function isActiveForAgent(status: string | null | undefined): boolean {
  return !!status && ACTIVE_FOR_AGENT_SET.has(status);
}

/**
 * Operational truth: did the agent physically arrive at the perimeter for this
 * assignment? Use this — not a status-set check — when computing "shifts the
 * agent worked", since it correctly captures cancelled_in_progress (admin
 * cancelled mid-shift; agent did real work) and in_progress (agent currently
 * working).
 */
export function wasWorked(assignment: { actual_entry_at: string | null }): boolean {
  return assignment.actual_entry_at !== null;
}

// ── Backwards-compat aliases ────────────────────────────────────────────────
// The geofence module previously exported these. We keep them as aliases so
// older imports keep working and the diff for this refactor stays surgical.

/** @deprecated Use LIVE_STATUSES from this module. */
export const ACTIVE_ASSIGNMENT_STATUSES: readonly string[] = LIVE_STATUSES;

/** @deprecated Use isLive() from this module. */
export function isActiveAssignmentStatus(status: string | null | undefined): boolean {
  return isLive(status);
}
