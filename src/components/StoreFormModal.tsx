'use client';
import { useEffect, useRef, useState, FormEvent, useCallback } from 'react';
import { useLanguage } from './LanguageContext';
import { STORE_TYPES, isStoreType } from '@/lib/stores';

export interface StoreInitial {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  geofence_radius_meters: number | null;
}

interface Props {
  onClose: () => void;
  onSaved: () => void;
  /** When provided, the modal opens in edit mode; otherwise create mode. */
  initialStore?: StoreInitial;
}

const PLACES_SCRIPT_ID = 'google-maps-places-script';

// Texas bounding box used by the new Places API as a locationRestriction:
//   SW corner: 25.84°N, -106.65°W
//   NE corner: 36.50°N,  -93.51°W
const TEXAS_LOCATION_RESTRICTION = {
  south: 25.84, west: -106.65, north: 36.50, east: -93.51,
};

// ── Minimal type shims for the new Places API surface we use. We avoid
// pulling in @types/google.maps just for one component. The shapes here
// match google.maps.places.AutocompleteSuggestion and Place from
// https://developers.google.com/maps/documentation/javascript/reference/places.
// ──────────────────────────────────────────────────────────────────────────
interface PlaceLocation { lat: () => number; lng: () => number }
interface PlaceLike {
  id?: string;
  location?: PlaceLocation;
  formattedAddress?: string;
  fetchFields(req: { fields: string[] }): Promise<unknown>;
}
interface PlaceConstructor { new (opts: { id: string }): PlaceLike }
interface PlacePrediction {
  placeId: string;
  text: { text: string };
  toPlace(): PlaceLike;
}
interface AutocompleteSuggestionResult {
  suggestions: { placePrediction?: PlacePrediction }[];
}
interface AutocompleteSuggestionStatic {
  fetchAutocompleteSuggestions(req: Record<string, unknown>): Promise<AutocompleteSuggestionResult>;
}
interface PlacesNamespace {
  AutocompleteSuggestion?: AutocompleteSuggestionStatic;
  Place?: PlaceConstructor;
}
interface MapsNamespace {
  places?: PlacesNamespace;
  importLibrary?: (lib: 'places') => Promise<unknown>;
}
interface GoogleNamespace { maps?: MapsNamespace }
declare global { interface Window { google?: GoogleNamespace } }

/**
 * Loads the Google Maps + Places JS SDK exactly once per page-load and
 * waits for the new Places library (window.google.maps.places.Place +
 * AutocompleteSuggestion) to be ready. With loading=async the outer
 * bundle's onload fires before the places library streams in, so we poll
 * for it until it appears or we hit an 8s timeout.
 */
type PlacesStatus = 'loading' | 'ready' | 'no-key' | 'error';

function usePlacesScript(): PlacesStatus {
  const [status, setStatus] = useState<PlacesStatus>('loading');
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key) { setStatus('no-key'); return; }
    if (typeof window === 'undefined') return;

    const placesReady = () =>
      !!(window.google?.maps?.places?.AutocompleteSuggestion && window.google?.maps?.places?.Place);

    if (placesReady()) { setStatus('ready'); return; }

    const startPolling = () => {
      const poll = setInterval(() => {
        if (placesReady()) { setStatus('ready'); clearInterval(poll); clearTimeout(timeout); }
      }, 100);
      const timeout = setTimeout(() => { clearInterval(poll); setStatus('error'); }, 8000);
      return () => { clearInterval(poll); clearTimeout(timeout); };
    };

    const existing = document.getElementById(PLACES_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) return startPolling();

    const s = document.createElement('script');
    s.id = PLACES_SCRIPT_ID;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&loading=async&v=weekly`;
    s.async = true;
    s.defer = true;

    let stopPoll: (() => void) | null = null;
    s.onload = () => {
      // Eagerly request the places library — with loading=async this is the
      // canonical way to await it (s.onload fires on outer bundle only).
      const importLib = window.google?.maps?.importLibrary;
      if (importLib) importLib('places').catch(() => { /* poll will catch failure */ });
      stopPoll = startPolling() ?? null;
    };
    s.onerror = () => setStatus('error');
    document.head.appendChild(s);
    return () => { if (stopPoll) stopPoll(); /* keep script in DOM for reuse */ };
  }, []);
  return status;
}

/**
 * gm_authFailure fires when the loaded SDK rejects the key (referrer
 * restriction, billing, etc.). We swap the form into manual-entry mode in
 * that case. No env-var name surfaces to the end user.
 */
function useGmAuthFailureWatch(onFail: () => void) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    type W = Window & { gm_authFailure?: () => void };
    const w = window as W;
    const prev = w.gm_authFailure;
    w.gm_authFailure = () => { onFail(); if (typeof prev === 'function') prev(); };
    return () => { w.gm_authFailure = prev; };
  }, [onFail]);
}

/**
 * Places combobox using the NEW Places API (March 2025).
 *
 *   AutocompleteSuggestion.fetchAutocompleteSuggestions → list of
 *   PlacePrediction. Selecting one builds a Place from the placeId and
 *   fetchFields(['location','formattedAddress']) gives lat/lng + address.
 *
 * Replaces the legacy AutocompleteService + PlacesService pair, which
 * Google flagged as "not available to new customers" as of March 1 2025
 * and which silently ignored bounds/strictBounds.
 */
function PlacesAddressInput({
  value,
  onChangeText,
  onSelect,
  placeholder,
  hint,
}: {
  value: string;
  onChangeText: (v: string) => void;
  onSelect: (address: string, lat: number, lng: number) => void;
  placeholder: string;
  hint: string;
}) {
  const [q, setQ] = useState(value);
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [showList, setShowList] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Keep external value in sync (e.g. initialStore in edit mode).
  useEffect(() => { setQ(value); }, [value]);

  // Debounced fetch from the new AutocompleteSuggestion API.
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 3) { setPredictions([]); return; }
    let cancelled = false;
    const handle = setTimeout(async () => {
      const ac = window.google?.maps?.places?.AutocompleteSuggestion;
      if (!ac) return;
      try {
        const res = await ac.fetchAutocompleteSuggestions({
          input: trimmed,
          // Two layers of Texas-only filtering. country=us drops non-US
          // results upstream; locationRestriction tells the new API to
          // refuse predictions whose geometry isn't inside the Texas box.
          // Both layers are still defended client-side by the regex below
          // because experiments show locationRestriction can return
          // out-of-box predictions for ambiguous matches.
          includedPrimaryTypes: ['street_address', 'premise', 'subpremise', 'route'],
          includedRegionCodes: ['us'],
          // locationRestriction expects a LatLngBoundsLiteral directly
          // ({ south, west, north, east }), NOT wrapped in `{ rectangle }`.
          // Wrapping triggers InvalidValueError and the request returns no
          // suggestions, which is what we saw earlier.
          locationRestriction: TEXAS_LOCATION_RESTRICTION,
        });
        if (cancelled) return;
        const list = (res?.suggestions ?? [])
          .map((s) => s.placePrediction)
          .filter((p): p is PlacePrediction => !!p)
          // Defense in depth: only addresses ending with ", TX" / ", Texas"
          // (optionally followed by a ZIP) are shown.
          .filter((p) => /,\s*(TX|Texas)(\s+\d|\s*,|$)/i.test(p.text?.text ?? ''));
        setPredictions(list);
      } catch (err) {
        // Network or auth failure surfaces as an empty dropdown + hint.
        console.error('Places fetchAutocompleteSuggestions failed:', err);
        if (!cancelled) setPredictions([]);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [q]);

  // Close the dropdown when clicking outside.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setShowList(false);
    }
    if (showList) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showList]);

  const handlePick = async (p: PlacePrediction) => {
    const desc = p.text?.text ?? '';
    setQ(desc);
    onChangeText(desc);
    setShowList(false);
    setPredictions([]);
    const PlaceCtor = window.google?.maps?.places?.Place;
    if (!PlaceCtor) return;
    try {
      const place = new PlaceCtor({ id: p.placeId });
      await place.fetchFields({ fields: ['location', 'formattedAddress'] });
      const loc = place.location;
      if (!loc) return;
      const lat = typeof loc.lat === 'function' ? loc.lat() : (loc.lat as unknown as number);
      const lng = typeof loc.lng === 'function' ? loc.lng() : (loc.lng as unknown as number);
      onSelect(place.formattedAddress ?? desc, lat, lng);
    } catch (err) {
      console.error('Place.fetchFields failed:', err);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          onChangeText(e.target.value);
          setShowList(true);
        }}
        onFocus={() => setShowList(true)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full max-w-full box-border px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm"
      />
      {showList && predictions.length > 0 && (
        <div className="absolute left-0 right-0 mt-1 z-30 max-h-72 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg">
          {predictions.map((p) => (
            <button
              key={p.placeId}
              type="button"
              onClick={() => handlePick(p)}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b border-gray-50 dark:border-gray-800 last:border-0"
            >
              {p.text?.text ?? ''}
            </button>
          ))}
        </div>
      )}
      {showList && q.trim().length >= 3 && predictions.length === 0 && (
        <p className="text-[10px] text-gray-400 mt-1">{hint}</p>
      )}
    </div>
  );
}

export default function StoreFormModal({ onClose, onSaved, initialStore }: Props) {
  const { t } = useLanguage();
  const placesStatusRaw = usePlacesScript();

  const [forcedError, setForcedError] = useState(false);
  const placesStatus: PlacesStatus = forcedError ? 'error' : placesStatusRaw;
  useGmAuthFailureWatch(useCallback(() => setForcedError(true), []));

  const isEdit = !!initialStore;

  // Migration logic for the name → type-selector change:
  //   - New store: empty selection, user must pick.
  //   - Edit + existing name matches a STORE_TYPES value: preselect it.
  //   - Edit + existing name is custom (e.g. legacy "Watt Distributors
  //     Office – Irving"): default to 'Other' and surface the original
  //     name in an info banner so the CEO knows what they're replacing.
  const initialName = initialStore?.name ?? '';
  const initialIsCustom = !!initialStore && !isStoreType(initialName);
  const [name, setName] = useState<string>(
    !initialStore ? ''
    : isStoreType(initialName) ? initialName
    : 'Other',
  );
  const [address, setAddress] = useState(initialStore?.address ?? '');
  const [latitude, setLatitude] = useState(
    initialStore ? String(initialStore.latitude) : ''
  );
  const [longitude, setLongitude] = useState(
    initialStore ? String(initialStore.longitude) : ''
  );
  const [radius, setRadius] = useState(
    String(initialStore?.geofence_radius_meters ?? 200)
  );

  // Coords are "locked" right after the user picks a Places suggestion. The
  // lat/lng inputs become read-only until the CEO clicks "Edit manually".
  const [coordsLocked, setCoordsLocked] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = name.trim();
    if (!trimmedName || !isStoreType(trimmedName)) {
      setFormError(t('stores.errorTypeRequired'));
      return;
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setFormError(t('stores.errorCoordsRequired'));
      return;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setFormError(t('stores.errorCoordsRange'));
      return;
    }
    const radNum = Math.max(50, Math.min(1000, parseInt(radius, 10) || 200));

    setSubmitting(true);
    try {
      const payload = {
        name: trimmedName,
        address: address.trim() || null,
        latitude: lat,
        longitude: lng,
        geofence_radius_meters: radNum,
      };
      const res = isEdit
        ? await fetch('/api/stores', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: initialStore!.id, ...payload }),
          })
        : await fetch('/api/stores', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        setFormError(t(isEdit ? 'stores.errorUpdate' : 'stores.errorCreate'));
        setSubmitting(false);
        return;
      }
      onSaved();
    } catch {
      setFormError(t(isEdit ? 'stores.errorUpdate' : 'stores.errorCreate'));
    }
    setSubmitting(false);
  }, [name, address, latitude, longitude, radius, t, onSaved, isEdit, initialStore]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-0 sm:px-4">
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full sm:max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
              {t(isEdit ? 'stores.editTitle' : 'stores.addTitle')}
            </h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {t(isEdit ? 'stores.editSubtitle' : 'stores.addSubtitle')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0"
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {placesStatus === 'no-key' && (
            <p className="text-[11px] rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-amber-800 dark:text-amber-200 leading-snug">
              ⚠️ {t('stores.placesNoKey')}
            </p>
          )}
          {placesStatus === 'error' && (
            <p className="text-[11px] rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-amber-800 dark:text-amber-200 leading-snug">
              ⚠️ {t('stores.placesError')}
            </p>
          )}

          {/* Type selector — replaces the legacy free-form name input.
              Six fixed options, single selection, commercial chains
              separated from operative ones with a divider. */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
              {t('stores.fieldType')}
            </label>
            {initialIsCustom && (
              <p className="mb-2 text-[10px] rounded-xl bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 px-3 py-2 text-sky-800 dark:text-sky-200 leading-snug">
                ℹ️ {t('stores.customNameInfo').replace('{name}', initialName)}
              </p>
            )}
            <div className="grid grid-cols-3 gap-2">
              {STORE_TYPES.slice(0, 3).map((opt) => {
                const active = name === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setName(opt)}
                    className={`px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                      active
                        ? 'text-white border-transparent'
                        : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                    style={active ? { backgroundColor: 'var(--primary)' } : {}}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            <div className="my-3 border-t border-gray-100 dark:border-gray-800" />
            <div className="grid grid-cols-3 gap-2">
              {STORE_TYPES.slice(3).map((opt) => {
                const active = name === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setName(opt)}
                    className={`px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                      active
                        ? 'text-white border-transparent'
                        : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                    style={active ? { backgroundColor: 'var(--primary)' } : {}}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
              {t('stores.fieldAddress')}
            </label>
            {placesStatus === 'ready' ? (
              <PlacesAddressInput
                value={address}
                onChangeText={(v) => {
                  setAddress(v);
                  if (coordsLocked) setCoordsLocked(false);
                }}
                onSelect={(addr, lat, lng) => {
                  setAddress(addr);
                  setLatitude(lat.toFixed(7));
                  setLongitude(lng.toFixed(7));
                  setCoordsLocked(true);
                }}
                placeholder={t('stores.addressPlaceholder')}
                hint={t('stores.placesHint')}
              />
            ) : (
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={t('stores.addressPlaceholder')}
                autoComplete="off"
                className="w-full max-w-full box-border px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm"
              />
            )}
            {placesStatus === 'loading' && (
              <p className="text-[10px] text-gray-400 mt-1">{t('stores.placesLoading')}</p>
            )}
          </div>

          {/* Coords row */}
          <div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
                  {t('stores.fieldLat')}
                </label>
                <input
                  type="number"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  step="any"
                  required
                  readOnly={coordsLocked}
                  className={`w-full max-w-full box-border px-3 py-2 rounded-xl border bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm tabular-nums ${
                    coordsLocked
                      ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}
                  style={{ minWidth: 0 }}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
                  {t('stores.fieldLng')}
                </label>
                <input
                  type="number"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  step="any"
                  required
                  readOnly={coordsLocked}
                  className={`w-full max-w-full box-border px-3 py-2 rounded-xl border bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm tabular-nums ${
                    coordsLocked
                      ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}
                  style={{ minWidth: 0 }}
                />
              </div>
            </div>
            {coordsLocked && (
              <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-gray-500 dark:text-gray-400">
                <span className="flex-1 leading-snug">🔒 {t('stores.coordsLocked')}</span>
                <button
                  type="button"
                  onClick={() => setCoordsLocked(false)}
                  className="text-[10px] font-bold text-[var(--primary)] underline underline-offset-2 hover:opacity-80 whitespace-nowrap flex-shrink-0"
                >
                  {t('stores.editCoordsManually')}
                </button>
              </div>
            )}
          </div>

          {/* Radius */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
              {t('stores.fieldRadius')}
            </label>
            <input
              type="number"
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              min={50}
              max={1000}
              className="w-full max-w-full box-border px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm tabular-nums"
              style={{ minWidth: 0 }}
            />
            <p className="text-[10px] text-gray-400 mt-1">{t('stores.radiusHint')}</p>
          </div>

          {formError && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2.5">
              {formError}
            </p>
          )}
        </form>

        {/* Footer actions */}
        <div className="flex gap-2 px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-60"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={(e) => handleSubmit(e as unknown as FormEvent)}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-60"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            {submitting
              ? t(isEdit ? 'stores.saving' : 'stores.creating')
              : t(isEdit ? 'stores.saveBtn' : 'stores.createBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}
