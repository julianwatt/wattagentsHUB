/**
 * Single source of truth for the "type" of a store. The CEO picks one of
 * these when creating/editing a store; the value is stored in the
 * `stores.name` column for backwards compatibility with everything that
 * already references it. Order matters — the first three are commercial
 * chains and render in one cluster; the last three are operative and
 * render below a divider.
 */
export const STORE_TYPES = ['El Rancho', 'HEB', 'Walmart', 'Other', 'Test Location', 'Office'] as const;
export const COMMERCIAL_STORE_TYPES = ['El Rancho', 'HEB', 'Walmart'] as const;
export type StoreType = (typeof STORE_TYPES)[number];

export function isStoreType(value: string): value is StoreType {
  return (STORE_TYPES as readonly string[]).includes(value);
}

/**
 * Parse a Google Places `formatted_address` (or any free-form address that
 * loosely follows the "<street>, <city>, <STATE> <ZIP>, <country>"
 * convention) into the three pieces we display: street, city, ZIP. State
 * and country are intentionally dropped — every store the CEO manages is in
 * Texas/USA so showing those tokens is noise.
 */
export function parseStoreAddress(formattedAddress: string | null | undefined): {
  street: string;
  city: string;
  zip: string;
} {
  if (!formattedAddress) return { street: '', city: '', zip: '' };
  const parts = formattedAddress.split(',').map((p) => p.trim()).filter(Boolean);
  const street = parts[0] ?? '';
  const city = parts[1] ?? '';
  // The state+ZIP segment is typically parts[2] ("TX 75062"). Fall back to
  // searching any segment for a 5-digit run so older addresses without the
  // standard structure still render a ZIP when one is present.
  const zip = (parts[2] ?? '').match(/\b\d{5}\b/)?.[0]
    ?? formattedAddress.match(/\b\d{5}\b/)?.[0]
    ?? '';
  return { street, city, zip };
}

/**
 * Canonical "TYPE - street, city, zip" label used in every place that
 * shows a store: the Tiendas listing, the assignment-form selector, the
 * history filter, agent cards, notifications. State and country are
 * never shown.
 *
 * Falls back gracefully when fields are missing — never produces double
 * commas or a trailing dash.
 *
 *   formatStoreLabel({ name: 'HEB', address: '4425 W Airport Fwy, Irving, TX 75062, USA' })
 *     → "HEB - 4425 W Airport Fwy, Irving, 75062"
 *   formatStoreLabel({ name: 'Office', address: null })
 *     → "OFFICE"
 */
export function formatStoreLabel(store: { name?: string | null; address?: string | null }): string {
  const type = (store.name ?? '').trim().toUpperCase();
  const { street, city, zip } = parseStoreAddress(store.address);
  const tail = [street, city, zip].filter((p) => p && p.length > 0).join(', ');
  if (!type) return tail;
  if (!tail) return type;
  return `${type} - ${tail}`;
}
