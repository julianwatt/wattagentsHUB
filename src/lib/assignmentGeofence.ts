/**
 * Business rules for the assignment geofencing system.
 * ============================================================================
 * Three concentric rings around the assigned store. The agent's distance to
 * the store determines which ring they're in, and ring transitions drive
 * events, time accounting, and CEO notifications.
 *
 * These constants are the single source of truth for the rules. Adjusting any
 * threshold/event-type/debounce in this file changes behaviour everywhere.
 * ============================================================================
 */

/** Inner ring — counts as "inside store"; effective shift time accumulates. */
export const RING_INNER_RADIUS_M = 200;

/** Warn ring — temporary exit; effective time PAUSES, CEO is notified. */
export const RING_WARN_RADIUS_M = 300;

/** Anything beyond warn radius is "outside_final" — auto-end of shift. */

/** Minimum gap between two CEO notifications of the same type for the same
 *  assignment, to avoid spam if the agent oscillates between rings. */
export const NOTIFICATION_DEBOUNCE_MS = 2 * 60 * 1000;

/** Punctuality grace period — arriving within this window of the scheduled
 *  start time still counts as "on time". */
export const PUNCTUALITY_GRACE_MIN = 5;

/** Beyond grace, before this cutoff counts as "late" (partial credit).
 *  Past this cutoff (or never arriving) is "no_show". */
export const PUNCTUALITY_LATE_CUTOFF_MIN = 30;

// ── Types ────────────────────────────────────────────────────────────────────
export type Ring = 'inner' | 'warn' | 'outer';

/** Event types persisted in `assignment_geofence_events.event_type`.
 *  Matches the DB CHECK constraint from Sesión 1. */
export type GeofenceEventType = 'entered' | 'exited_warn' | 'exited_final' | 'reentered';

/** Statuses for an assignment that allow new geofence events to be recorded. */
export const ACTIVE_STATUSES = ['accepted', 'in_progress'] as const;

// ── Ring determination ───────────────────────────────────────────────────────
export function ringForDistance(meters: number): Ring {
  if (meters <= RING_INNER_RADIUS_M) return 'inner';
  if (meters <= RING_WARN_RADIUS_M) return 'warn';
  return 'outer';
}

/**
 * Map a (previousRing, currentRing) transition to the event type to record.
 * Returns null when the transition does not require a new event (e.g. same
 * ring, or initial position outside that hasn't entered yet).
 *
 * Rules:
 *   prev=null, curr=inner            → 'entered'  (initial entry)
 *   prev=null, curr=warn             → null       (don't record warn-without-entry)
 *   prev=null, curr=outer            → null       (still hasn't arrived)
 *   prev=inner, curr=warn            → 'exited_warn'
 *   prev=inner, curr=outer           → 'exited_final'
 *   prev=warn,  curr=inner           → 'reentered'   (back from temporary exit)
 *   prev=warn,  curr=outer           → 'exited_final'
 *   prev=outer, curr=inner           → 'reentered'   (reactivation after final exit)
 *   prev=outer, curr=warn            → null       (still effectively out)
 *   any same-ring transition         → null
 */
export function eventTypeForTransition(
  prev: Ring | null,
  curr: Ring,
): GeofenceEventType | null {
  if (prev === curr) return null;

  if (prev === null) {
    return curr === 'inner' ? 'entered' : null;
  }

  if (curr === 'inner') return 'reentered';
  if (curr === 'warn' && prev === 'inner') return 'exited_warn';
  if (curr === 'outer') return 'exited_final';
  // prev=outer, curr=warn — no event; agent is still effectively out.
  return null;
}

// ── Effective time calculation ───────────────────────────────────────────────
export interface AssignmentEvent {
  event_type: GeofenceEventType;
  occurred_at: string; // ISO timestamp
}

/**
 * Walk the events in order and sum the time the agent spent inside the inner
 * ring. The agent is considered "in the inner ring" between an entry/reentry
 * event and the next non-inner event (exited_warn / exited_final).
 *
 * If `liveNow` is provided AND the most recent event leaves the agent inside
 * the inner ring, time keeps accumulating up to `liveNow`. Otherwise, the
 * effective time only counts up to the last exit event.
 *
 * Returns the total in *milliseconds*. Caller can divide by 60000 for minutes.
 */
export function computeEffectiveMs(
  events: AssignmentEvent[],
  liveNow?: Date,
): number {
  if (events.length === 0) return 0;

  const sorted = [...events].sort((a, b) =>
    a.occurred_at.localeCompare(b.occurred_at),
  );

  let totalMs = 0;
  let insideSince: Date | null = null;

  for (const ev of sorted) {
    const t = new Date(ev.occurred_at);
    const isInside = ev.event_type === 'entered' || ev.event_type === 'reentered';

    if (isInside && insideSince === null) {
      // Started a new "inside" interval.
      insideSince = t;
    } else if (!isInside && insideSince !== null) {
      // Closed the current "inside" interval.
      totalMs += t.getTime() - insideSince.getTime();
      insideSince = null;
    }
    // Other transitions (e.g. inside→inside or out→out) don't change state
    // here because eventTypeForTransition already filters them.
  }

  // If the last event left the agent inside, count up to liveNow (default: now).
  if (insideSince !== null) {
    const end = liveNow ?? new Date();
    totalMs += end.getTime() - insideSince.getTime();
  }

  return Math.max(0, totalMs);
}

// ── Compliance determination ─────────────────────────────────────────────────
export type Punctuality = 'on_time' | 'late' | 'no_show';

export interface ComplianceResult {
  effective_minutes: number;
  met_duration: boolean;
  punctuality: Punctuality;
}

/**
 * Compute compliance indicators from the raw assignment data + events.
 *
 *  - met_duration : effective_minutes >= expected_duration_min
 *  - punctuality  : on_time   if entry within PUNCTUALITY_GRACE_MIN of scheduled
 *                   late      if entry within PUNCTUALITY_LATE_CUTOFF_MIN
 *                   no_show   if entry never recorded or > cutoff late
 */
export function computeCompliance(args: {
  shift_date: string;             // YYYY-MM-DD
  scheduled_start_time: string;   // HH:MM[:SS]
  expected_duration_min: number;
  actual_entry_at: string | null; // ISO
  events: AssignmentEvent[];
  liveNow?: Date;                 // for in-progress calculations
}): ComplianceResult {
  const totalMs = computeEffectiveMs(args.events, args.liveNow);
  const minutes = Math.floor(totalMs / 60000);

  const met_duration = minutes >= args.expected_duration_min;

  // Build the scheduled start in the SAME reference frame as `actual_entry_at`
  // (UTC ISO). `shift_date` (date) and `scheduled_start_time` (time) are
  // timezone-naive; we compare them as UTC. This assumes the project operates
  // in a single, consistent timezone — fine for the Watt Distributors
  // internal tool. If a future deployment serves multiple timezones, store
  // the offset on the assignment row and apply it here.
  const time = args.scheduled_start_time.length === 5
    ? `${args.scheduled_start_time}:00`
    : args.scheduled_start_time;
  const scheduled = new Date(`${args.shift_date}T${time}Z`);

  let punctuality: Punctuality = 'no_show';
  if (args.actual_entry_at) {
    const entry = new Date(args.actual_entry_at);
    const diffMin = (entry.getTime() - scheduled.getTime()) / 60000;
    if (diffMin <= PUNCTUALITY_GRACE_MIN) {
      punctuality = 'on_time';
    } else if (diffMin <= PUNCTUALITY_LATE_CUTOFF_MIN) {
      punctuality = 'late';
    } else {
      punctuality = 'no_show';
    }
  }

  return {
    effective_minutes: minutes,
    met_duration,
    punctuality,
  };
}
