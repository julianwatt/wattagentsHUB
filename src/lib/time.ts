/**
 * Project timezone — single source of truth for "today" across the app.
 *
 * Watt Distributors operates out of Dallas, Texas (US Central Time, with
 * automatic DST handling via Intl). Both the Vercel server runtime and any
 * client browser must agree on which calendar date is "today" — using
 * `new Date().toISOString().slice(0, 10)` returns UTC, which silently flips
 * to "tomorrow" around 19:00 local each evening (18:00 in winter), hiding
 * the day's assignments from queries keyed on shift_date.
 *
 * Both helpers are isomorphic (server + client) — they rely only on the
 * Intl API which is available in every supported runtime.
 *
 * TODO: make configurable via process.env.PROJECT_TIMEZONE if/when the
 * project expands beyond a single timezone.
 */
export const LOCAL_TIMEZONE = 'America/Chicago';

/** Today's calendar date in LOCAL_TIMEZONE, formatted 'YYYY-MM-DD'. */
export function localToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: LOCAL_TIMEZONE });
}

/** N days before today in LOCAL_TIMEZONE, formatted 'YYYY-MM-DD'. */
export function localDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400_000)
    .toLocaleDateString('en-CA', { timeZone: LOCAL_TIMEZONE });
}
