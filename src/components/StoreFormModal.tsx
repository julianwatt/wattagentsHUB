'use client';
import { useEffect, useRef, useState, FormEvent, useCallback } from 'react';
import usePlacesAutocomplete, { getGeocode, getLatLng } from 'use-places-autocomplete';
import { useLanguage } from './LanguageContext';

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

interface GoogleMapsGlobal { maps?: { places?: unknown } }
declare global { interface Window { google?: GoogleMapsGlobal } }

/**
 * Loads the Google Maps + Places JS SDK exactly once per page-load. We
 * mount the <script> on the first hook call and any subsequent mount just
 * waits for window.google to appear. Status surfaces through the form so
 * the CEO sees a clear banner when autocomplete isn't usable and can fall
 * back to manual entry.
 */
type PlacesStatus = 'loading' | 'ready' | 'no-key' | 'error';

function usePlacesScript(): PlacesStatus {
  const [status, setStatus] = useState<PlacesStatus>('loading');
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key) {
      console.warn('[stores] NEXT_PUBLIC_GOOGLE_MAPS_API_KEY missing — autocomplete disabled');
      setStatus('no-key');
      return;
    }
    if (typeof window === 'undefined') return;
    if (window.google?.maps?.places) { setStatus('ready'); return; }

    const existing = document.getElementById(PLACES_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      const check = setInterval(() => {
        if (window.google?.maps?.places) { setStatus('ready'); clearInterval(check); }
      }, 100);
      const timeout = setTimeout(() => {
        clearInterval(check);
        console.warn('[stores] Maps SDK never reported window.google.maps.places after 8s');
        setStatus('error');
      }, 8000);
      return () => { clearInterval(check); clearTimeout(timeout); };
    }

    const s = document.createElement('script');
    s.id = PLACES_SCRIPT_ID;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&v=weekly`;
    s.async = true;
    s.defer = true;
    s.onload = () => {
      if (window.google?.maps?.places) {
        console.info('[stores] Maps SDK loaded — places library ready');
        setStatus('ready');
      } else {
        console.warn('[stores] Maps SDK loaded but places library is missing');
        setStatus('error');
      }
    };
    s.onerror = (ev) => {
      console.warn('[stores] Maps SDK script failed to load (network/CSP/referrer block):', ev);
      setStatus('error');
    };
    document.head.appendChild(s);
    return () => { /* keep script in DOM for reuse across mounts */ };
  }, []);
  return status;
}

/**
 * Google's Places SDK surfaces auth/quota failures via window.gm_authFailure
 * (no key, restricted referer, billing off, daily quota exceeded). We swap
 * the form into "manual entry" mode and log a generic warning — never the
 * env-var name or the literal Google error.
 */
function useGmAuthFailureWatch(onFail: () => void) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    type W = Window & { gm_authFailure?: () => void };
    const w = window as W;
    const prev = w.gm_authFailure;
    w.gm_authFailure = () => {
      console.warn('[stores] Maps SDK auth failure (gm_authFailure) — likely API restriction or billing/quota issue');
      onFail();
      if (typeof prev === 'function') prev();
    };
    return () => { w.gm_authFailure = prev; };
  }, [onFail]);
}

/**
 * Inner Places combobox — only mounted when the SDK is `ready` so the
 * usePlacesAutocomplete hook can call AutocompleteService immediately.
 *
 * Renders our own dropdown driven by predictions returned from Google's
 * AutocompleteService (not the legacy widget). This avoids the widget's
 * positioning/z-index issues inside our fixed-position modal AND surfaces
 * any prediction-fetch errors directly to the console.
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
  const {
    ready,
    value: q,
    setValue,
    suggestions: { status: predStatus, data: predictions, loading: predLoading },
    clearSuggestions,
  } = usePlacesAutocomplete({
    requestOptions: {
      // Prefer addresses (street-level results). Empty geocode types fall
      // through to mixed results — restricting to 'address' keeps the list
      // tight and accurate for store entry.
      types: ['address'],
    },
    debounce: 250,
  });

  // Sync external value (e.g. when initialStore loads in edit mode) into
  // the hook's internal state. We only push when the parent's text differs
  // so we don't loop with the user's typing.
  useEffect(() => {
    if (value !== q) setValue(value, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Log non-OK statuses so production debugging is possible without
  // having to change code. ZERO_RESULTS for very short queries is normal.
  useEffect(() => {
    if (predStatus && predStatus !== 'OK' && predStatus !== '' && predStatus !== 'ZERO_RESULTS') {
      console.warn('[stores] Places AutocompleteService status:', predStatus);
    }
  }, [predStatus]);

  const [showList, setShowList] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setShowList(false);
    }
    if (showList) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showList]);

  const handlePick = async (description: string) => {
    setValue(description, false);
    onChangeText(description);
    setShowList(false);
    clearSuggestions();
    try {
      const results = await getGeocode({ address: description });
      const { lat, lng } = await getLatLng(results[0]);
      onSelect(description, lat, lng);
    } catch (err) {
      console.warn('[stores] geocode failed:', err);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={q}
        disabled={!ready}
        onChange={(e) => {
          setValue(e.target.value);
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
              key={p.place_id}
              type="button"
              onClick={() => handlePick(p.description)}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b border-gray-50 dark:border-gray-800 last:border-0"
            >
              <span className="font-medium">{p.structured_formatting?.main_text ?? p.description}</span>
              {p.structured_formatting?.secondary_text && (
                <span className="block text-[10px] text-gray-400 truncate">{p.structured_formatting.secondary_text}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {showList && q.trim().length >= 3 && !predLoading && predictions.length === 0 && predStatus === 'ZERO_RESULTS' && (
        <p className="text-[10px] text-gray-400 mt-1">{hint}</p>
      )}
      {ready && q.trim().length < 3 && (
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

  const [name, setName] = useState(initialStore?.name ?? '');
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

  // Coords are "locked" right after the user picks a Places suggestion.
  // The lat/lng inputs become read-only with an "Edit manually" button.
  // In edit mode we start unlocked so existing coords stay editable; in
  // create mode we also start unlocked because nothing's filled yet.
  const [coordsLocked, setCoordsLocked] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = name.trim();
    if (!trimmedName) { setFormError(t('stores.errorNameRequired')); return; }

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
          {/* Places-status banner */}
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

          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
              {t('stores.fieldName')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
              className="w-full max-w-full box-border px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm"
            />
          </div>

          {/* Address with Places autocomplete */}
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
                  placeholder="32.83867"
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
                  placeholder="-97.01237"
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

        {/* Footer actions — always visible */}
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
