'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { usePushSubscription } from './usePushSubscription';
import { useLanguage } from './LanguageContext';
import { useShift, ShiftEvent, ShiftStore } from './ShiftContext';

// ── Helpers ──
function fmtTimeShort(iso: string, lang: string): string {
  return new Date(iso).toLocaleTimeString(lang === 'en' ? 'en-US' : 'es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const EVENT_ICONS: Record<string, string> = {
  clock_in: '🟢', lunch_start: '🍽️', lunch_end: '🔄', clock_out: '🔴',
};

const EVENT_LABEL_KEYS: Record<string, string> = {
  clock_in: 'shift.clockIn', lunch_start: 'shift.lunchStart',
  lunch_end: 'shift.lunchEnd', clock_out: 'shift.clockOut',
};

interface Props { userId: string; }

// ── Component ──
export default function ShiftPanel({ userId }: Props) {
  const { t, lang } = useLanguage();
  const { shiftState: state, events, store, loading, pushEvent, clockInTime, refresh } = useShift();

  // Local-only UI state (not shared)
  const [stores, setStores] = useState<ShiftStore[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  const [storesLoading, setStoresLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<string>('');
  const [lastResult, setLastResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [geofenceWarning, setGeofenceWarning] = useState<string>('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchRef = useRef<number | null>(null);
  const lastAlertRef = useRef<number>(0);

  // Push subscription
  const { isSupported: pushSupported, permission: pushPermission, isSubscribed: pushSubscribed, subscribe: pushSubscribe, loading: pushLoading } = usePushSubscription();

  // ── Load store list on mount ──
  useEffect(() => {
    (async () => {
      setStoresLoading(true);
      try {
        const res = await fetch('/api/shift/stores', { cache: 'no-store' });
        if (res.ok) {
          const list: ShiftStore[] = await res.json();
          setStores(list);
          // Default to current shift store or first in list
          if (store) {
            setSelectedStoreId(store.id);
          } else if (list.length > 0) {
            setSelectedStoreId(list[0].id);
          }
        }
      } catch {}
      setStoresLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync selectedStoreId when context store changes
  useEffect(() => {
    if (store) setSelectedStoreId(store.id);
  }, [store]);

  // ── Chronometer ──
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if ((state === 'active' || state === 'break') && clockInTime) {
      const update = () => setElapsed(Date.now() - (clockInTime || Date.now()));
      update();
      timerRef.current = setInterval(update, 1000);
    } else {
      setElapsed(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state, clockInTime]);

  // ── Continuous geofencing ──
  useEffect(() => {
    if (state !== 'active' || !store) {
      if (watchRef.current !== null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
      setGeofenceWarning('');
      return;
    }
    if (!('geolocation' in navigator)) return;

    watchRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const R = 6_371_000;
        const dLat = ((store.latitude - latitude) * Math.PI) / 180;
        const dLng = ((store.longitude - longitude) * Math.PI) / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos((latitude * Math.PI) / 180) * Math.cos((store.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
        const dist = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));

        if (dist > store.geofence_radius_meters) {
          const now = Date.now();
          if (now - lastAlertRef.current > 3 * 60 * 1000) {
            lastAlertRef.current = now;
            setGeofenceWarning(t('shift.geofenceWarning').replace('{dist}', String(dist)).replace('{store}', store.name));
            const clockInEvt = events.find((e) => e.event_type === 'clock_in');
            try {
              await fetch('/api/shift/geofence-alert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ storeId: store.id, latitude, longitude, shiftLogId: clockInEvt?.id || null }),
              });
            } catch {}
          }
        } else {
          setGeofenceWarning('');
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    );

    return () => {
      if (watchRef.current !== null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
    };
  }, [state, store, events, t]);

  // ── Get GPS position (3-tier fallback) ──
  const getPosition = useCallback(async (): Promise<{ latitude: number; longitude: number; method: string } | null> => {
    if (!('geolocation' in navigator)) {
      // No browser geolocation → try IP fallback directly
      setGpsStatus(t('shift.gpsTryingIp'));
      try {
        const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const data = await res.json();
          if (data.latitude && data.longitude) {
            setGpsStatus('');
            return { latitude: data.latitude, longitude: data.longitude, method: 'ip' };
          }
        }
      } catch {}
      setGpsStatus(t('shift.gpsAllFailed'));
      return null;
    }

    // Tier 1: High accuracy
    setGpsStatus(t('shift.gpsObtaining'));
    const tier1 = await new Promise<{ latitude: number; longitude: number } | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
      );
    });
    if (tier1) { setGpsStatus(''); return { ...tier1, method: 'gps_high' }; }

    // Tier 2: Low accuracy
    setGpsStatus(t('shift.gpsTryingLowAccuracy'));
    const tier2 = await new Promise<{ latitude: number; longitude: number } | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
      );
    });
    if (tier2) { setGpsStatus(''); return { ...tier2, method: 'gps_low' }; }

    // Tier 3: IP geolocation
    setGpsStatus(t('shift.gpsTryingIp'));
    try {
      const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json();
        if (data.latitude && data.longitude) {
          setGpsStatus('');
          return { latitude: data.latitude, longitude: data.longitude, method: 'ip' };
        }
      }
    } catch {}

    // All failed
    setGpsStatus(t('shift.gpsAllFailed'));
    return null;
  }, [t]);

  // ── Register shift event ──
  const handleEvent = useCallback(async (eventType: ShiftEvent['event_type']) => {
    setActing(true);
    setLastResult(null);
    setGpsStatus('');

    const storeId = store?.id || selectedStoreId;
    if (!storeId) {
      setLastResult({ ok: false, message: t('shift.selectStore') });
      setActing(false);
      return;
    }

    const pos = await getPosition();

    try {
      const res = await fetch('/api/shift/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId,
          eventType,
          latitude: pos?.latitude ?? null,
          longitude: pos?.longitude ?? null,
          geoMethod: pos?.method ?? 'none',
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setLastResult({ ok: false, message: err.error || t('shift.eventError') });
        setActing(false);
        return;
      }

      const data = await res.json();
      const newEvent: ShiftEvent = data.event;

      // Determine new state
      let newState = state;
      let newStore: ShiftStore | null | undefined;
      if (eventType === 'clock_in') {
        newState = 'active';
        newStore = stores.find((s) => s.id === storeId) ?? null;
      } else if (eventType === 'lunch_start') {
        newState = 'break';
      } else if (eventType === 'lunch_end') {
        newState = 'active';
      } else if (eventType === 'clock_out') {
        newState = 'idle';
        newStore = null;
      }

      // Update shared context (immediately available to all consumers)
      pushEvent(newEvent, newState, newStore);

      // Result message
      const eventLabel = t(EVENT_LABEL_KEYS[eventType]);
      const time = fmtTimeShort(newEvent.event_time, lang);
      if (!pos) {
        setLastResult({ ok: true, message: `${eventLabel} ${t('shift.registeredAt')} ${time}. ${t('shift.locationNotVerified')}` });
      } else if (data.geofence && !data.geofence.isInside) {
        setLastResult({ ok: false, message: `${eventLabel} ${t('shift.registeredAt')} ${time}. ⚠️ ${t('shift.outsidePerimeter').replace('{dist}', String(data.geofence.distanceMeters))}` });
      } else {
        setLastResult({ ok: true, message: `${eventLabel} ${t('shift.registeredAt')} ${time}. ✓ ${t('shift.locationVerified')}` });
      }
    } catch {
      setLastResult({ ok: false, message: t('shift.connectionError') });
    }

    setActing(false);
  }, [store, selectedStoreId, stores, getPosition, t, lang, state, pushEvent]);

  // ── Status badge ──
  const statusConfig = {
    idle: { label: t('shift.statusIdle'), color: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400', dot: 'bg-gray-400' },
    active: { label: t('shift.statusActive'), color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300', dot: 'bg-green-500' },
    break: { label: t('shift.statusBreak'), color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300', dot: 'bg-amber-500' },
  };
  const status = statusConfig[state];

  if (loading || storesLoading) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          {t('shift.loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-5 py-3 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">⏱️</span>
          <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">{t('shift.title')}</h3>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${status.color}`}>
          <span className={`w-2 h-2 rounded-full ${status.dot} ${state === 'active' ? 'animate-pulse' : ''}`} />
          {status.label}
        </div>
      </div>

      <div className="px-4 sm:px-5 py-4 space-y-4">
        {/* Chronometer */}
        {(state === 'active' || state === 'break') && (
          <div className="text-center">
            <p className="text-4xl sm:text-5xl font-mono font-bold text-gray-900 dark:text-gray-100 tabular-nums tracking-wider">
              {formatElapsed(elapsed)}
            </p>
            <p className="text-[10px] text-gray-400 mt-1 uppercase tracking-wide">{t('shift.elapsed')}</p>
          </div>
        )}

        {/* Store selector — only when idle */}
        {state === 'idle' && (
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">{t('shift.storeLabel')}</label>
            <select
              value={selectedStoreId}
              onChange={(e) => setSelectedStoreId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm"
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {stores.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">{t('shift.noStores')}</p>
            )}
          </div>
        )}

        {/* Store info — when active */}
        {store && (state === 'active' || state === 'break') && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800/50 text-xs text-gray-600 dark:text-gray-300">
            <span>📍</span>
            <span className="font-medium">{store.name}</span>
          </div>
        )}

        {/* Geofence warning */}
        {geofenceWarning && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-medium">
            <span className="flex-shrink-0">🚨</span>
            <span>{geofenceWarning}</span>
          </div>
        )}

        {/* GPS status */}
        {gpsStatus && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            {gpsStatus}
          </div>
        )}

        {/* Action buttons */}
        <div className="space-y-2">
          {state === 'idle' && (
            <button onClick={() => handleEvent('clock_in')} disabled={acting || !selectedStoreId}
              className="w-full py-3 md:py-3.5 rounded-xl font-bold text-white text-sm transition-all active:scale-[0.98] disabled:opacity-50"
              style={{ backgroundColor: '#10b981' }}>
              {acting ? t('shift.verifyingLocation') : `🟢 ${t('shift.btnClockIn')}`}
            </button>
          )}
          {state === 'active' && (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => handleEvent('lunch_start')} disabled={acting}
                className="py-3 md:py-3.5 rounded-xl font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50 bg-amber-500 text-white">
                {acting ? '...' : `🍽️ ${t('shift.btnLunchStart')}`}
              </button>
              <button onClick={() => handleEvent('clock_out')} disabled={acting}
                className="py-3 md:py-3.5 rounded-xl font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50 bg-red-500 text-white">
                {acting ? '...' : `🔴 ${t('shift.btnClockOut')}`}
              </button>
            </div>
          )}
          {state === 'break' && (
            <button onClick={() => handleEvent('lunch_end')} disabled={acting}
              className="w-full py-3 md:py-3.5 rounded-xl font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50 text-white"
              style={{ backgroundColor: 'var(--primary)' }}>
              {acting ? t('shift.verifyingLocation') : `🔄 ${t('shift.btnLunchEnd')}`}
            </button>
          )}
        </div>

        {/* Last action result */}
        {lastResult && (
          <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs font-medium ${
            lastResult.ok
              ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
              : 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
          }`}>
            <span>{lastResult.message}</span>
          </div>
        )}

        {/* Timeline */}
        {events.length > 0 && (
          <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">{t('shift.timelineTitle')}</p>
            <div className="space-y-1.5">
              {[...events].reverse().map((evt) => (
                <div key={evt.id} className="flex items-center gap-2.5 text-xs">
                  <span className="flex-shrink-0">{EVENT_ICONS[evt.event_type] || '⏺'}</span>
                  <span className="font-medium text-gray-700 dark:text-gray-200">{t(EVENT_LABEL_KEYS[evt.event_type]) || evt.event_type}</span>
                  <span className="text-gray-400 ml-auto tabular-nums">{fmtTimeShort(evt.event_time, lang)}</span>
                  {evt.is_at_location === false && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300">{evt.distance_meters}m</span>
                  )}
                  {evt.is_at_location === true && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-300">✓</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Push subscription prompt */}
        {pushSupported && !pushSubscribed && pushPermission !== 'denied' && (
          <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
            <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <p className="text-xs text-blue-700 dark:text-blue-300">🔔 {t('shift.pushPrompt')}</p>
              <button onClick={pushSubscribe} disabled={pushLoading}
                className="no-min-size flex-shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--primary)' }}>
                {pushLoading ? t('shift.pushActivating') : t('shift.pushActivate')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
