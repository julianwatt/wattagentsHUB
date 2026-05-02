/**
 * Smoke tests for the assignment geofence helpers (Sesión 5 BLOQUE 6).
 *
 *   npx tsx scripts/test-assignment-geofence.ts
 *
 * Exercises the 5 scenarios from the prompt against the pure functions in
 * src/lib/assignmentGeofence.ts. No DB writes — this verifies the maths.
 */
import {
  ringForDistance,
  eventTypeForTransition,
  computeEffectiveMs,
  computeCompliance,
  RING_INNER_RADIUS_M,
  RING_WARN_RADIUS_M,
  type AssignmentEvent,
  type GeofenceEventType,
  type Ring,
} from '../src/lib/assignmentGeofence';

let failures = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}
function eq<T>(label: string, actual: T, expected: T) {
  ok(label, actual === expected, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// ── Sanity: ring boundaries ─────────────────────────────────────────────────
console.log('\n── Ring boundaries ──');
eq('0m → inner',      ringForDistance(0),                          'inner' as Ring);
eq('199m → inner',    ringForDistance(199),                        'inner' as Ring);
eq('200m → inner',    ringForDistance(RING_INNER_RADIUS_M),        'inner' as Ring);
eq('201m → warn',     ringForDistance(201),                        'warn' as Ring);
eq('300m → warn',     ringForDistance(RING_WARN_RADIUS_M),         'warn' as Ring);
eq('301m → outer',    ringForDistance(301),                        'outer' as Ring);
eq('5000m → outer',   ringForDistance(5000),                       'outer' as Ring);

// ── Sanity: transitions ─────────────────────────────────────────────────────
console.log('\n── Transitions ──');
eq('null→inner = entered',           eventTypeForTransition(null, 'inner'),    'entered' as GeofenceEventType);
eq('null→warn = noop',               eventTypeForTransition(null, 'warn'),     null);
eq('null→outer = noop',              eventTypeForTransition(null, 'outer'),    null);
eq('inner→warn = exited_warn',       eventTypeForTransition('inner', 'warn'),  'exited_warn' as GeofenceEventType);
eq('inner→outer = exited_final',     eventTypeForTransition('inner', 'outer'), 'exited_final' as GeofenceEventType);
eq('warn→inner = reentered',         eventTypeForTransition('warn', 'inner'),  'reentered' as GeofenceEventType);
eq('warn→outer = exited_final',      eventTypeForTransition('warn', 'outer'),  'exited_final' as GeofenceEventType);
eq('outer→inner = reentered (re-act)', eventTypeForTransition('outer', 'inner'), 'reentered' as GeofenceEventType);
eq('outer→warn = noop',              eventTypeForTransition('outer', 'warn'),  null);
eq('inner→inner = noop',             eventTypeForTransition('inner', 'inner'), null);

// ── Helpers for time-based scenarios ────────────────────────────────────────
function ev(type: GeofenceEventType, mins: number): AssignmentEvent {
  // Anchor the timeline at a fixed point so tests are deterministic
  return {
    event_type: type,
    occurred_at: new Date(Date.parse('2026-05-02T10:00:00Z') + mins * 60_000).toISOString(),
  };
}
const SHIFT_DATE = '2026-05-02';
const SCHEDULED = '10:00';
const EXPECTED_DURATION = 360; // 6h
const liveNow = (mins: number) => new Date(Date.parse('2026-05-02T10:00:00Z') + mins * 60_000);

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1 — Ideal: enters on time, stays 6h continuous, exits.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Scenario 1: ideal 6h shift ──');
{
  const events: AssignmentEvent[] = [
    ev('entered', 0),       // 10:00 entry, on time
    ev('exited_final', 360), // 16:00 exit (6h later)
  ];
  const c = computeCompliance({
    shift_date: SHIFT_DATE,
    scheduled_start_time: SCHEDULED,
    expected_duration_min: EXPECTED_DURATION,
    actual_entry_at: events[0].occurred_at,
    events,
    liveNow: liveNow(360),
  });
  eq('effective_minutes = 360', c.effective_minutes, 360);
  eq('met_duration = true',     c.met_duration,     true);
  eq('punctuality = on_time',   c.punctuality,      'on_time' as const);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2 — Tardanza: arrives 15 min late, completes 6h.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Scenario 2: 15-min late, 6h shift ──');
{
  const events: AssignmentEvent[] = [
    ev('entered', 15),
    ev('exited_final', 15 + 360),
  ];
  const c = computeCompliance({
    shift_date: SHIFT_DATE,
    scheduled_start_time: SCHEDULED,
    expected_duration_min: EXPECTED_DURATION,
    actual_entry_at: events[0].occurred_at,
    events,
    liveNow: liveNow(15 + 360),
  });
  eq('effective_minutes = 360', c.effective_minutes, 360);
  eq('met_duration = true',     c.met_duration,     true);
  eq('punctuality = late',      c.punctuality,      'late' as const);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3 — Salida temporal: enters, drifts to warn for 10 min, returns,
//   then completes the shift.
//   Time in warn does NOT count.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Scenario 3: temporary exit (warn ring) ──');
{
  const events: AssignmentEvent[] = [
    ev('entered', 0),
    ev('exited_warn', 60),  // 10:00 + 60 min: 60 min inside
    ev('reentered', 70),    // 10:10 outside, 10 min PAUSED
    ev('exited_final', 70 + 300), // 6h after re-entry
  ];
  const c = computeCompliance({
    shift_date: SHIFT_DATE,
    scheduled_start_time: SCHEDULED,
    expected_duration_min: EXPECTED_DURATION,
    actual_entry_at: events[0].occurred_at,
    events,
    liveNow: liveNow(70 + 300),
  });
  // Effective = 60 min (first inside) + 300 min (after re-entry) = 360 min
  eq('effective_minutes = 360 (warn period excluded)', c.effective_minutes, 360);
  eq('met_duration = true',  c.met_duration,  true);
  eq('punctuality = on_time', c.punctuality,  'on_time' as const);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4 — Fin de turno automático: enters, completes 3h, leaves >300m
//   without returning. Marked as not-met.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Scenario 4: auto-end after 3h ──');
{
  const events: AssignmentEvent[] = [
    ev('entered', 0),
    ev('exited_final', 180), // exits >300m at 13:00 (3h in)
  ];
  const c = computeCompliance({
    shift_date: SHIFT_DATE,
    scheduled_start_time: SCHEDULED,
    expected_duration_min: EXPECTED_DURATION,
    actual_entry_at: events[0].occurred_at,
    events,
    liveNow: liveNow(180),
  });
  eq('effective_minutes = 180', c.effective_minutes, 180);
  eq('met_duration = false',    c.met_duration,    false);
  eq('punctuality = on_time',   c.punctuality,    'on_time' as const);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5 — Reactivación: enters, 2h inside, exits >300m, an hour later
//   returns inside, completes 4h more.
//   Total effective = 2h + 4h = 6h, met.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Scenario 5: reactivation after final exit ──');
{
  const events: AssignmentEvent[] = [
    ev('entered', 0),
    ev('exited_final', 120),     // 2h inside
    ev('reentered', 180),        // 1h later returns (1h pause)
    ev('exited_final', 180 + 240), // 4h more inside
  ];
  const c = computeCompliance({
    shift_date: SHIFT_DATE,
    scheduled_start_time: SCHEDULED,
    expected_duration_min: EXPECTED_DURATION,
    actual_entry_at: events[0].occurred_at,
    events,
    liveNow: liveNow(180 + 240),
  });
  // 2h + 4h = 360 min effective
  eq('effective_minutes = 360', c.effective_minutes, 360);
  eq('met_duration = true',     c.met_duration,     true);
  eq('punctuality = on_time',   c.punctuality,    'on_time' as const);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bonus — In-progress (no exit yet): time keeps accumulating up to liveNow.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Bonus: in-progress live time ──');
{
  const events: AssignmentEvent[] = [ev('entered', 0)];
  const ms = computeEffectiveMs(events, liveNow(125));
  eq('effective ms ≈ 125 min', Math.round(ms / 60_000), 125);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bonus — No-show: never entered.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Bonus: no-show ──');
{
  const c = computeCompliance({
    shift_date: SHIFT_DATE,
    scheduled_start_time: SCHEDULED,
    expected_duration_min: EXPECTED_DURATION,
    actual_entry_at: null,
    events: [],
    liveNow: liveNow(600),
  });
  eq('effective_minutes = 0',   c.effective_minutes, 0);
  eq('met_duration = false',    c.met_duration,    false);
  eq('punctuality = no_show',   c.punctuality,    'no_show' as const);
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('\n────────────────────────────────────────');
if (failures === 0) {
  console.log('\x1b[32m✓ All scenarios passed\x1b[0m');
  process.exit(0);
} else {
  console.log(`\x1b[31m✗ ${failures} assertion(s) failed\x1b[0m`);
  process.exit(1);
}
