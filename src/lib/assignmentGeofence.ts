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

/**
 * Operational timezone of the business. The CEO enters `scheduled_start_time`
 * in this timezone (Texas / Central Time), and the column stores it as a
 * naive `time without time zone`. Pairing it with `shift_date` and treating
 * the result as UTC is wrong — that was the source of the 4–6h "late_severe"
 * bug. Use scheduledStartUtc() to do the conversion correctly through DST.
 *
 * Configurable via NEXT_PUBLIC_BUSINESS_TZ at build time if the operation
 * ever expands to other regions; defaults to America/Chicago.
 */
export const BUSINESS_TIMEZONE: string =
  process.env.NEXT_PUBLIC_BUSINESS_TZ ?? 'America/Chicago';

/**
 * Compute the UTC `Date` instant that corresponds to the wall-clock
 * "shift_date + scheduled_start_time" in the business timezone, including
 * the correct DST offset for that day.
 *
 *   scheduledStartUtc('2026-05-03', '10:00:00')
 *     → 2026-05-03T15:00:00Z   (CDT = UTC-5 in May)
 */
export function scheduledStartUtc(
  shiftDate: string,
  scheduledStartTime: string,
  tz: string = BUSINESS_TIMEZONE,
): Date {
  const time = scheduledStartTime.length === 5
    ? `${scheduledStartTime}:00`
    : scheduledStartTime;
  // First, treat the literal date+time as if it were UTC. This gives us a
  // reference Date object whose absolute UTC components match the wall-clock
  // we want — but the moment itself is wrong by exactly the tz offset.
  const naive = new Date(`${shiftDate}T${time}Z`);
  // Now ask Intl what wall-clock that naive UTC moment maps to in `tz`.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(naive);
  const o: Record<string, string> = {};
  for (const p of parts) o[p.type] = p.value;
  const hour = Number(o.hour) === 24 ? 0 : Number(o.hour); // Intl edge case
  const localAsUtc = Date.UTC(
    Number(o.year), Number(o.month) - 1, Number(o.day),
    hour, Number(o.minute), Number(o.second),
  );
  // The offset (in ms) between the naive UTC and the local-time-as-UTC.
  // For Chicago in May: offset = -5h. We need to shift `naive` BACK by that
  // offset to land on the true UTC moment.
  const offsetMs = localAsUtc - naive.getTime();
  return new Date(naive.getTime() - offsetMs);
}

/** Punctuality grace period — arriving within this window of the scheduled
 *  start time still counts as "on time". */
export const PUNCTUALITY_GRACE_MIN = 5;

/** Beyond grace, before this cutoff counts as "late" (partial credit).
 *  Past this cutoff transitions into the heavier "late_arrival" buckets. */
export const PUNCTUALITY_LATE_CUTOFF_MIN = 30;

/** Beyond LATE_CUTOFF, up to this many minutes counts as "late_arrival"
 *  (Retardo). Past this cutoff is "late_severe" (Retardo significativo). */
export const PUNCTUALITY_LATE_ARRIVAL_CUTOFF_MIN = 120;

// ── Types ────────────────────────────────────────────────────────────────────
export type Ring = 'inner' | 'warn' | 'outer';

/** Event types persisted in `assignment_geofence_events.event_type`.
 *  Matches the DB CHECK constraint from Sesión 1. */
export type GeofenceEventType = 'entered' | 'exited_warn' | 'exited_final' | 'reentered';

/** Statuses for an assignment that allow new geofence events to be recorded. */
export const ACTIVE_STATUSES = ['accepted', 'in_progress'] as const;

/**
 * "Active assignment" set — the statuses that count as the agent CURRENTLY
 * having an assignment for the day. Drives the one-per-day uniqueness rule
 * and the "Hoy" panel filter.
 *
 *   pending      — created but not yet accepted; still ties up the day
 *   accepted     — agent committed; awaiting arrival
 *   in_progress  — agent inside the perimeter
 *   completed    — terminal but counts as "today's assignment was X"
 *   incomplete   — terminal, didn't hit the duration; still the day's record
 *
 * Statuses NOT in this set (cancelled, cancelled_in_progress, rejected,
 * replaced, no_show) are inactive: a new assignment can be created for the
 * same agent + day without conflict, and they don't surface in the active
 * panel.
 */
export const ACTIVE_ASSIGNMENT_STATUSES: readonly string[] = [
  'pending', 'accepted', 'in_progress', 'completed', 'incomplete',
];

export function isActiveAssignmentStatus(status: string | null | undefined): boolean {
  return !!status && ACTIVE_ASSIGNMENT_STATUSES.includes(status);
}

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
/**
 * Five-bucket punctuality classification. The first three buckets reflect
 * varying degrees of "still made the shift"; the last two flag missed or
 * effectively missed shifts.
 *
 *   on_time       ≤ 5 min late (within grace)
 *   late          5–30 min late (tarde tolerable, partial credit)
 *   late_arrival  30 min – 2 h late (Retardo)
 *   late_severe   > 2 h late but did arrive (Retardo significativo)
 *   no_show       never arrived
 */
export type Punctuality = 'on_time' | 'late' | 'late_arrival' | 'late_severe' | 'no_show';

export interface ComplianceResult {
  effective_minutes: number;
  met_duration: boolean;
  punctuality: Punctuality;
}

/**
 * Single source of truth for translating an entry timestamp into a
 * Punctuality bucket. Used everywhere the platform asks "how late was the
 * agent?" so the thresholds never drift between UI and server.
 */
export function punctualityForEntry(args: {
  shift_date: string;             // YYYY-MM-DD
  scheduled_start_time: string;   // HH:MM[:SS], in BUSINESS_TIMEZONE wall-clock
  actual_entry_at: string | null; // ISO UTC; null means never arrived
}): Punctuality {
  if (!args.actual_entry_at) return 'no_show';
  const scheduled = scheduledStartUtc(args.shift_date, args.scheduled_start_time);
  const entry = new Date(args.actual_entry_at);
  const diffMin = (entry.getTime() - scheduled.getTime()) / 60000;
  if (diffMin <= PUNCTUALITY_GRACE_MIN) return 'on_time';
  if (diffMin <= PUNCTUALITY_LATE_CUTOFF_MIN) return 'late';
  if (diffMin <= PUNCTUALITY_LATE_ARRIVAL_CUTOFF_MIN) return 'late_arrival';
  return 'late_severe';
}

/**
 * Live status for an assignment that hasn't started yet (no actual_entry_at).
 *   pending_arrival   now < scheduled
 *   awaiting_arrival  scheduled ≤ now ≤ scheduled + 2h
 *   no_show           now > scheduled + 2h, agent never arrived
 *
 * Once the agent enters the perimeter, callers should switch to
 * punctualityForEntry() — that bucket has the authoritative answer.
 */
export type LivePunctuality = 'pending_arrival' | 'awaiting_arrival' | 'no_show';
export function liveStatusBeforeEntry(args: {
  shift_date: string;
  scheduled_start_time: string;
  now?: Date;
}): LivePunctuality {
  const scheduled = scheduledStartUtc(args.shift_date, args.scheduled_start_time);
  const now = args.now ?? new Date();
  const diffMin = (now.getTime() - scheduled.getTime()) / 60000;
  if (diffMin < 0) return 'pending_arrival';
  if (diffMin <= PUNCTUALITY_LATE_ARRIVAL_CUTOFF_MIN) return 'awaiting_arrival';
  return 'no_show';
}

/**
 * Compute compliance indicators from the raw assignment data + events.
 *
 *  - met_duration : effective_minutes >= expected_duration_min
 *  - punctuality  : delegated to punctualityForEntry (5 buckets).
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

  return {
    effective_minutes: minutes,
    met_duration: minutes >= args.expected_duration_min,
    punctuality: punctualityForEntry({
      shift_date: args.shift_date,
      scheduled_start_time: args.scheduled_start_time,
      actual_entry_at: args.actual_entry_at,
    }),
  };
}
