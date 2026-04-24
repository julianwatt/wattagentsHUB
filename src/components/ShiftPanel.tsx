'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { usePushSubscription } from './usePushSubscription';

// ── Types ──
interface ShiftEvent {
  id: string;
  event_type: 'clock_in' | 'lunch_start' | 'lunch_end' | 'clock_out';
  event_time: string;
  is_at_location: boolean | null;
  distance_meters: number | null;
}

interface Store {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  geofence_radius_meters: number;
}

type ShiftState = 'idle' | 'active' | 'break';

interface Props {
  userId: string;
}

// ── Helpers ──
function fmtTimeShort(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const EVENT_LABELS: Record<string, string> = {
  clock_in: 'Inicio de turno',
  lunch_start: 'Inicio de descanso',
  lunch_end: 'Regreso de descanso',
  clock_out: 'Fin de turno',
};

const EVENT_ICONS: Record<string, string> = {
  clock_in: '🟢',
  lunch_start: '🍽️',
  lunch_end: '🔄',
  clock_out: '🔴',
};

// ── Component ──
export default function ShiftPanel({ userId }: Props) {
  const [state, setState] = useState<ShiftState>('idle');
  const [events, setEvents] = useState<ShiftEvent[]>([]);
  const [store, setStore] = useState<Store | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<string>('');
  const [lastResult, setLastResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [geofenceWarning, setGeofenceWarning] = useState<string>('');
  const clockInTime = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchRef = useRef<number | null>(null);
  const lastAlertRef = useRef<number>(0);

  // Push subscription
  const { isSupported: pushSupported, permission: pushPermission, isSubscribed: pushSubscribed, subscribe: pushSubscribe, loading: pushLoading } = usePushSubscription();

  // ── Load stores + active shift on mount ──
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // Fetch stores
        const storesRes = await fetch('/api/shift/stores');
        if (storesRes.ok) {
          const storeList: Store[] = await storesRes.json();
          setStores(storeList);
          if (storeList.length > 0) setSelectedStoreId(storeList[0].id);
        }

        // Fetch active shift
        const shiftRes = await fetch('/api/shift');
        if (shiftRes.ok) {
          const data = await shiftRes.json();
          if (data.active && data.events?.length > 0) {
            setEvents(data.events);
            setStore(data.store);
            if (data.store) setSelectedStoreId(data.store.id);
            // Determine state from events
            const lastEvent = data.events[data.events.length - 1];
            if (lastEvent.event_type === 'lunch_start') {
              setState('break');
            } else {
              setState('active');
            }
            // Set clock_in time for chronometer
            const clockIn = data.events.find((e: ShiftEvent) => e.event_type === 'clock_in');
            if (clockIn) clockInTime.current = new Date(clockIn.event_time).getTime();
          }
        }
      } catch (err) {
        console.error('[ShiftPanel] init error:', err);
      }
      setLoading(false);
    })();
  }, [userId]);

  // ── Chronometer ──
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if ((state === 'active' || state === 'break') && clockInTime.current) {
      const update = () => setElapsed(Date.now() - (clockInTime.current || Date.now()));
      update();
      timerRef.current = setInterval(update, 1000);
    } else {
      setElapsed(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state]);

  // ── Continuous geofencing (Bloque 2) ──
  useEffect(() => {
    if (state !== 'active' || !store) {
      // Stop watching when not active
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
        // Haversine inline (avoid importing server module)
        const R = 6_371_000;
        const dLat = ((store.latitude - latitude) * Math.PI) / 180;
        const dLng = ((store.longitude - longitude) * Math.PI) / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos((latitude * Math.PI) / 180) * Math.cos((store.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
        const dist = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));

        if (dist > store.geofence_radius_meters) {
          const now = Date.now();
          // Throttle: 3 minutes between alerts
          if (now - lastAlertRef.current > 3 * 60 * 1000) {
            lastAlertRef.current = now;
            setGeofenceWarning(`Estás a ${dist}m de ${store.name}. El administrador ha sido notificado.`);
            // Find the clock_in event for shiftLogId
            const clockInEvt = events.find((e) => e.event_type === 'clock_in');
            try {
              await fetch('/api/shift/geofence-alert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  storeId: store.id,
                  latitude,
                  longitude,
                  shiftLogId: clockInEvt?.id || null,
                }),
              });
            } catch {}
          }
        } else {
          setGeofenceWarning('');
        }
      },
      () => { /* GPS error — ignore silently during watch */ },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    );

    return () => {
      if (watchRef.current !== null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
    };
  }, [state, store, events]);

  // ── Get GPS position ──
  const getPosition = useCallback((): Promise<{ latitude: number; longitude: number } | null> => {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) {
        setGpsStatus('GPS no disponible');
        resolve(null);
        return;
      }
      setGpsStatus('Obteniendo ubicación...');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGpsStatus('');
          resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        },
        () => {
          setGpsStatus('No se pudo obtener ubicación');
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    });
  }, []);

  // ── Register shift event ──
  const handleEvent = useCallback(async (eventType: ShiftEvent['event_type']) => {
    setActing(true);
    setLastResult(null);
    setGpsStatus('');

    const storeId = store?.id || selectedStoreId;
    if (!storeId) {
      setLastResult({ ok: false, message: 'Selecciona una tienda' });
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
          latitude: pos?.latitude ?? 0,
          longitude: pos?.longitude ?? 0,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setLastResult({ ok: false, message: err.error || 'Error al registrar evento' });
        setActing(false);
        return;
      }

      const data = await res.json();
      const newEvent: ShiftEvent = data.event;
      setEvents((prev) => [...prev, newEvent]);

      // Update state
      if (eventType === 'clock_in') {
        clockInTime.current = new Date(newEvent.event_time).getTime();
        setState('active');
        // Set the store from the response
        const selectedStore = stores.find((s) => s.id === storeId);
        if (selectedStore) setStore(selectedStore);
      } else if (eventType === 'lunch_start') {
        setState('break');
      } else if (eventType === 'lunch_end') {
        setState('active');
      } else if (eventType === 'clock_out') {
        setState('idle');
        clockInTime.current = null;
      }

      // Result message
      if (!pos) {
        setLastResult({ ok: true, message: `${EVENT_LABELS[eventType]} registrado a las ${fmtTimeShort(newEvent.event_time)}. No se pudo verificar la ubicación.` });
      } else if (data.geofence && !data.geofence.isInside) {
        setLastResult({ ok: false, message: `${EVENT_LABELS[eventType]} registrado a las ${fmtTimeShort(newEvent.event_time)}. ⚠️ Estabas a ${data.geofence.distanceMeters}m de la tienda. El administrador fue notificado.` });
      } else {
        setLastResult({ ok: true, message: `${EVENT_LABELS[eventType]} registrado a las ${fmtTimeShort(newEvent.event_time)}. ✓ Ubicación verificada.` });
      }
    } catch (err) {
      setLastResult({ ok: false, message: 'Error de conexión' });
    }

    setActing(false);
  }, [store, selectedStoreId, stores, getPosition]);

  // ── Status badge ──
  const statusConfig = {
    idle: { label: 'Sin turno activo', color: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400', dot: 'bg-gray-400' },
    active: { label: 'Turno en curso', color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300', dot: 'bg-green-500' },
    break: { label: 'En descanso', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300', dot: 'bg-amber-500' },
  };
  const status = statusConfig[state];

  if (loading) {
    return (
      <div className="mb-5 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          Cargando turno...
        </div>
      </div>
    );
  }

  return (
    <div className="mb-5 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-5 py-3 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">⏱️</span>
          <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">Control de Turno</h3>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${status.color}`}>
          <span className={`w-2 h-2 rounded-full ${status.dot} ${state === 'active' ? 'animate-pulse' : ''}`} />
          {status.label}
        </div>
      </div>

      <div className="px-4 sm:px-5 py-4 space-y-4">
        {/* Chronometer — visible when shift active or on break */}
        {(state === 'active' || state === 'break') && (
          <div className="text-center">
            <p className="text-4xl sm:text-5xl font-mono font-bold text-gray-900 dark:text-gray-100 tabular-nums tracking-wider">
              {formatElapsed(elapsed)}
            </p>
            <p className="text-[10px] text-gray-400 mt-1 uppercase tracking-wide">Tiempo transcurrido</p>
          </div>
        )}

        {/* Store selector — only when idle */}
        {state === 'idle' && (
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">Tienda</label>
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
              <p className="text-xs text-gray-400 mt-1">No hay tiendas registradas</p>
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
            <button
              onClick={() => handleEvent('clock_in')}
              disabled={acting || !selectedStoreId}
              className="w-full py-3 md:py-3.5 rounded-xl font-bold text-white text-sm transition-all active:scale-[0.98] disabled:opacity-50"
              style={{ backgroundColor: '#10b981' }}
            >
              {acting ? 'Verificando ubicación...' : '🟢 Iniciar Turno'}
            </button>
          )}

          {state === 'active' && (
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleEvent('lunch_start')}
                disabled={acting}
                className="py-3 md:py-3.5 rounded-xl font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50 bg-amber-500 text-white"
              >
                {acting ? '...' : '🍽️ Descanso'}
              </button>
              <button
                onClick={() => handleEvent('clock_out')}
                disabled={acting}
                className="py-3 md:py-3.5 rounded-xl font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50 bg-red-500 text-white"
              >
                {acting ? '...' : '🔴 Finalizar'}
              </button>
            </div>
          )}

          {state === 'break' && (
            <button
              onClick={() => handleEvent('lunch_end')}
              disabled={acting}
              className="w-full py-3 md:py-3.5 rounded-xl font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50 text-white"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              {acting ? 'Verificando ubicación...' : '🔄 Regresar de Descanso'}
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
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Eventos del turno</p>
            <div className="space-y-1.5">
              {events.map((evt) => (
                <div key={evt.id} className="flex items-center gap-2.5 text-xs">
                  <span className="flex-shrink-0">{EVENT_ICONS[evt.event_type] || '⏺'}</span>
                  <span className="font-medium text-gray-700 dark:text-gray-200">{EVENT_LABELS[evt.event_type] || evt.event_type}</span>
                  <span className="text-gray-400 ml-auto tabular-nums">{fmtTimeShort(evt.event_time)}</span>
                  {evt.is_at_location === false && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300">
                      {evt.distance_meters}m
                    </span>
                  )}
                  {evt.is_at_location === true && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-300">
                      ✓
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Push subscription prompt (Bloque 3) */}
        {pushSupported && !pushSubscribed && pushPermission !== 'denied' && (
          <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
            <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <p className="text-xs text-blue-700 dark:text-blue-300">
                🔔 Activa las notificaciones para recibir alertas importantes.
              </p>
              <button
                onClick={pushSubscribe}
                disabled={pushLoading}
                className="no-min-size flex-shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                {pushLoading ? '...' : 'Activar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
