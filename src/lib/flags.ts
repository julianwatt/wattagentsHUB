/**
 * Feature flags
 *
 * Simple env-var-based flags. Read at request time on the server and
 * inlined at build time on the client (via NEXT_PUBLIC_* prefix).
 *
 * To enable a flag locally: add the var to .env.local with value "1".
 * To enable in production: set the var in Vercel project settings.
 *
 * Default behaviour with the var unset is: flag OFF.
 */

function isOn(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Legacy self-managed shift control panel (clock_in / lunch_start / lunch_end /
 * clock_out buttons + ShiftPanel + /shift page + nav entry).
 *
 * The new assignment-based flow replaces this. The legacy code is kept in
 * the tree so we can fall back if needed, but is hidden by default.
 *
 * Set NEXT_PUBLIC_LEGACY_SHIFT_PANEL=1 to expose it.
 */
export function isLegacyShiftPanelEnabled(): boolean {
  return isOn(process.env.NEXT_PUBLIC_LEGACY_SHIFT_PANEL);
}
