'use client';
import { useEffect, useRef, useState } from 'react';
import { useLanguage } from './LanguageContext';
import { haversineMeters } from '@/lib/geo';
import { ringForDistance, type Ring } from '@/lib/assignmentGeofence';

interface ActiveAssignment {
  id: string;
  shift_date: string;          // YYYY-MM-DD
  store: { latitude: number; longitude: number } | null;
}

interface Props { assignment: ActiveAssignment; }

const todayLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Continuous geolocation tracker for an accepted/in_progress assignment.
 *
 * Runs ONLY when the assignment's shift_date is today. Uses
 * `navigator.geolocation.watchPosition` with a low-accuracy preference (less
 * battery) and a 30s maximumAge cache. On every position update we compute the
 * agent's ring; if it differs from the last ring we sent to the server, we
 * POST to /api/assignments/[id]/geofence-event. If the ring hasn't changed,
 * nothing is sent — the server only cares about transitions.
 *
 * The component renders nothing visible; it's a side-effect controller. A
 * persistent UX hint ("keep app open") is shown by AssignmentCards.
 */
export default function AssignmentTracker({ assignment }: Props) {
  // Last ring we successfully sent to the server (in-memory only).
  // We trust the server to reconcile if this gets out of sync.
  const lastSentRingRef = useRef<Ring | null>(null);
  // Coalesce in-flight requests: don't fire a second POST while one is pending
  const inFlightRef = useRef<boolean>(false);

  const [permissionDenied, setPermissionDenied] = useState(false);

  const isToday = assignment.shift_date === todayLocal();
  const hasStore = !!assignment.store;

  useEffect(() => {
    if (!isToday || !hasStore) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    let watchId: number | null = null;
    let cancelled = false;

    const onPosition = async (pos: GeolocationPosition) => {
      if (cancelled) return;
      if (!assignment.store) return;
      const dist = haversineMeters(
        pos.coords.latitude,
        pos.coords.longitude,
        assignment.store.latitude,
        assignment.store.longitude,
      );
      // Compute geo_method first so ringForDistance can apply the wider
      // outer threshold (500m) for low-confidence readings — keeping the
      // client's ring computation aligned with the server's, otherwise the
      // client thinks "outer" at 350m gps_low and stops sending updates
      // even though the server (correctly) keeps that as 'warn'.
      const accuracy = pos.coords.accuracy;
      const geo_method = accuracy != null && accuracy <= 50 ? 'gps_high' : 'gps_low';
      const ring = ringForDistance(dist, geo_method);

      // Only POST when ring changed AND there isn't a pending request
      if (ring === lastSentRingRef.current) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      try {
        const res = await fetch(`/api/assignments/${assignment.id}/geofence-event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            geo_method,
            current_ring: ring,
            previous_ring: lastSentRingRef.current,
          }),
        });
        if (res.ok) {
          // Update our in-memory ring state to match what we sent
          lastSentRingRef.current = ring;
        }
      } catch {
        /* network error — try again on next position update */
      }
      inFlightRef.current = false;
    };

    const onError = (err: GeolocationPositionError) => {
      if (err.code === err.PERMISSION_DENIED) {
        setPermissionDenied(true);
      }
      // For other errors (timeout/unavailable) we just keep the watch running;
      // the next position fix will be attempted automatically.
    };

    try {
      watchId = navigator.geolocation.watchPosition(
        onPosition,
        onError,
        { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 },
      );
    } catch {
      /* watchPosition itself threw — bail silently */
    }

    return () => {
      cancelled = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [assignment.id, assignment.store, isToday, hasStore]);

  return permissionDenied ? <PermissionDeniedNotice /> : null;
}

function PermissionDeniedNotice() {
  const { t } = useLanguage();
  return (
    <div className="rounded-2xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 mt-3">
      <p className="text-xs font-bold text-red-700 dark:text-red-300 mb-0.5">
        ⚠️ {t('assignments.locationPermissionTitle')}
      </p>
      <p className="text-[11px] text-red-700/80 dark:text-red-300/80">
        {t('assignments.locationPermissionBody')}
      </p>
    </div>
  );
}
