'use client';
import { useEffect, useRef, useState, FormEvent, useCallback } from 'react';
import { useLanguage } from './LanguageContext';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

const PLACES_SCRIPT_ID = 'google-maps-places-script';

// Minimal subset of the Places Autocomplete API that we use, typed
// inline so we don't pull in @types/google.maps for one component.
interface PlaceResult {
  formatted_address?: string;
  name?: string;
  geometry?: { location?: { lat: () => number; lng: () => number } };
}
interface AutocompleteInstance {
  addListener(event: string, handler: () => void): void;
  getPlace(): PlaceResult;
}
interface GoogleMapsGlobal {
  maps?: {
    places?: {
      Autocomplete: new (input: HTMLInputElement, opts?: Record<string, unknown>) => AutocompleteInstance;
    };
  };
}

declare global {
  interface Window { google?: GoogleMapsGlobal; }
}

/**
 * Loads the Google Maps + Places JS SDK once per page-load. Returns:
 *   - 'loading' while the script is being fetched
 *   - 'ready' once window.google.maps.places is available
 *   - 'no-key' if NEXT_PUBLIC_GOOGLE_MAPS_API_KEY isn't configured
 *   - 'error' if the script failed to load
 *
 * The form falls back to manual lat/lng entry when the SDK isn't ready,
 * so the CEO can still create stores without the API.
 */
type PlacesStatus = 'loading' | 'ready' | 'no-key' | 'error';

function usePlacesScript(): PlacesStatus {
  const [status, setStatus] = useState<PlacesStatus>('loading');
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key) { setStatus('no-key'); return; }
    if (typeof window === 'undefined') return;
    if (window.google?.maps?.places) { setStatus('ready'); return; }

    const existing = document.getElementById(PLACES_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      // Another mount is already loading the script — wait for window.google
      const check = setInterval(() => {
        if (window.google?.maps?.places) { setStatus('ready'); clearInterval(check); }
      }, 100);
      const timeout = setTimeout(() => { clearInterval(check); setStatus('error'); }, 8000);
      return () => { clearInterval(check); clearTimeout(timeout); };
    }

    const s = document.createElement('script');
    s.id = PLACES_SCRIPT_ID;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&v=weekly`;
    s.async = true;
    s.defer = true;
    s.onload = () => setStatus('ready');
    s.onerror = () => setStatus('error');
    document.head.appendChild(s);
    return () => { /* keep script in DOM for reuse */ };
  }, []);
  return status;
}

export default function StoreFormModal({ onClose, onCreated }: Props) {
  const { t } = useLanguage();
  const placesStatus = usePlacesScript();

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [radius, setRadius] = useState('200');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const addressInputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<AutocompleteInstance | null>(null);

  // Wire the Places Autocomplete onto the address input when the SDK is
  // ready. The user gets dropdown suggestions and selecting one fills the
  // lat/lng inputs automatically.
  useEffect(() => {
    if (placesStatus !== 'ready') return;
    if (!addressInputRef.current || autocompleteRef.current) return;
    const places = window.google?.maps?.places;
    if (!places) return;

    const ac = new places.Autocomplete(addressInputRef.current, {
      fields: ['formatted_address', 'name', 'geometry'],
      types: ['address'],
    });
    ac.addListener('place_changed', () => {
      const p = ac.getPlace();
      if (p.geometry?.location) {
        setLatitude(p.geometry.location.lat().toFixed(7));
        setLongitude(p.geometry.location.lng().toFixed(7));
      }
      if (p.formatted_address) setAddress(p.formatted_address);
    });
    autocompleteRef.current = ac;
  }, [placesStatus]);

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
      const res = await fetch('/api/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          address: address.trim() || null,
          latitude: lat,
          longitude: lng,
          geofence_radius_meters: radNum,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFormError(data?.error ?? t('stores.errorCreate'));
        setSubmitting(false);
        return;
      }
      onCreated();
    } catch {
      setFormError(t('stores.errorCreate'));
    }
    setSubmitting(false);
  }, [name, address, latitude, longitude, radius, t, onCreated]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-0 sm:px-4">
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full sm:max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{t('stores.addTitle')}</h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('stores.addSubtitle')}</p>
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
            <input
              ref={addressInputRef}
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={t('stores.addressPlaceholder')}
              autoComplete="off"
              className="w-full max-w-full box-border px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm"
            />
            {placesStatus === 'loading' && (
              <p className="text-[10px] text-gray-400 mt-1">{t('stores.placesLoading')}</p>
            )}
            {placesStatus === 'ready' && (
              <p className="text-[10px] text-gray-400 mt-1">{t('stores.placesHint')}</p>
            )}
          </div>

          {/* Coords row */}
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
                placeholder="32.83867"
                className="w-full max-w-full box-border px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm tabular-nums"
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
                placeholder="-97.01237"
                className="w-full max-w-full box-border px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm tabular-nums"
                style={{ minWidth: 0 }}
              />
            </div>
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
            {submitting ? t('stores.creating') : t('stores.createBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}
