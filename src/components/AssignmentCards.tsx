'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useLanguage } from './LanguageContext';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { haversineMeters, fmtDistance } from '@/lib/geo';
import AssignmentTracker from './AssignmentTracker';
import AssignmentProgressCard from './AssignmentProgressCard';
import type { GeofenceEventType } from '@/lib/assignmentGeofence';

// ── Types ────────────────────────────────────────────────────────────────────
interface MyLastEvent {
  event_type: GeofenceEventType;
  occurred_at: string;
  distance_meters: number | null;
  geo_method: string | null;
}

interface MyAssignment {
  id: string;
  agent_id: string;
  assigned_by: string;
  store_id: string;
  shift_date: string;            // YYYY-MM-DD
  scheduled_start_time: string;  // HH:MM:SS or HH:MM
  expected_duration_min: number;
  status: 'pending' | 'accepted' | 'rejected' | 'in_progress' | 'completed' | 'incomplete' | 'cancelled';
  rejection_reason: string | null;
  agent_response_at: string | null;
  actual_entry_at: string | null;
  created_at: string;
  assigner: { id: string; name: string } | null;
  store: {
    id: string;
    name: string;
    address: string | null;
    latitude: number;
    longitude: number;
    geofence_radius_meters: number;
  } | null;
  // Enrichments from /api/assignments/my
  last_event: MyLastEvent | null;
  effective_ms_now: number;
}

interface MyEnvelope {
  live: MyAssignment[];
  recentRejected: MyAssignment[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const todayLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Build a Date for the assignment's local start time.
 *  shift_date is YYYY-MM-DD, scheduled_start_time is HH:MM[:SS]. */
function startDateTime(a: MyAssignment): Date {
  const time = a.scheduled_start_time.length === 5
    ? `${a.scheduled_start_time}:00`
    : a.scheduled_start_time;
  return new Date(`${a.shift_date}T${time}`);
}

/** "Faltan 1h 23min para tu turno" / "Hora de entrada: hace 5 minutos" */
function formatCountdown(target: Date, t: (k: string) => string): string {
  const diffMs = target.getTime() - Date.now();
  const absMin = Math.abs(Math.round(diffMs / 60000));
  const future = diffMs > 0;

  if (absMin < 1) return t('assignments.cdNow');

  const days = Math.floor(absMin / 1440);
  const hours = Math.floor((absMin % 1440) / 60);
  const mins = absMin % 60;

  let chunk = '';
  if (days > 0) chunk = `${days}d ${hours}h`;
  else if (hours > 0) chunk = `${hours}h ${mins}m`;
  else chunk = `${mins}m`;

  return future
    ? t('assignments.cdRemaining').replace('{time}', chunk)
    : t('assignments.cdAgo').replace('{time}', chunk);
}

/** Open a maps app appropriate for the device. */
function openMaps(address: string | null, lat: number, lng: number) {
  if (typeof window === 'undefined') return;
  const ua = navigator.userAgent;
  const dest = address
    ? encodeURIComponent(address)
    : `${lat},${lng}`;

  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);

  if (isIOS) {
    // Apple Maps. Falls back gracefully to web maps if the app is missing.
    window.location.href = `https://maps.apple.com/?daddr=${dest}`;
    return;
  }
  if (isAndroid) {
    // geo: intent → opens Google Maps if installed, otherwise default mapping app.
    window.location.href = `geo:0,0?q=${dest}`;
    return;
  }
  // Desktop: Google Maps directions in a new tab
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${dest}`, '_blank', 'noopener');
}

// ── Component ────────────────────────────────────────────────────────────────
interface Props {
  /** Pass the role from the session so we don't render for non-agents. */
  role: string;
}

export default function AssignmentCards({ role }: Props) {
  const { t, lang } = useLanguage();

  const [data, setData] = useState<MyEnvelope>({ live: [], recentRejected: [] });
  const [loaded, setLoaded] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Reject modal state
  const [rejectFor, setRejectFor] = useState<MyAssignment | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Geolocation for the active card's distance
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);

  // Tick to force countdown re-render every minute. Exposed as `tick` for
  // child components that derive their own time-dependent state from it.
  const [tick, setNowTick] = useState(0);

  // Skip everything if not an agent
  const isAgent = role === 'agent';

  // ── Fetch ───────────────────────────────────────────────────────────────
  const fetchMine = useCallback(async () => {
    if (!isAgent) { setLoaded(true); return; }
    try {
      const res = await fetch('/api/assignments/my', { cache: 'no-store' });
      if (res.ok) {
        const j: MyEnvelope = await res.json();
        setData(j);
      }
    } catch {
      /* silent */
    }
    setLoaded(true);
  }, [isAgent]);

  useEffect(() => { fetchMine(); }, [fetchMine]);

  // Realtime: re-fetch on any assignments change for the agent
  useEffect(() => {
    if (!isAgent) return;
    const sb = getSupabaseBrowser();
    const channel = sb
      .channel('my-assignments-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments' }, () => { fetchMine(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_notifications' }, () => { fetchMine(); })
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [isAgent, fetchMine]);

  // Re-fetch on tab focus / visibility change
  useEffect(() => {
    if (!isAgent) return;
    const onVisible = () => { if (document.visibilityState === 'visible') fetchMine(); };
    const onFocus = () => fetchMine();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [isAgent, fetchMine]);

  // Tick the countdown every minute
  useEffect(() => {
    if (!isAgent) return;
    const id = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [isAgent]);

  // Geolocation watch (only when there's an accepted card to display)
  const hasAcceptedCard = useMemo(() => data.live.some((a) => a.status === 'accepted' || a.status === 'in_progress'), [data.live]);

  useEffect(() => {
    if (!isAgent || !hasAcceptedCard || typeof navigator === 'undefined' || !navigator.geolocation) return;
    let watchId: number | null = null;
    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setPosition(null),
        { enableHighAccuracy: false, maximumAge: 60_000, timeout: 15_000 },
      );
    } catch { /* ignore */ }
    return () => { if (watchId !== null) navigator.geolocation.clearWatch(watchId); };
  }, [isAgent, hasAcceptedCard]);

  // ── Action handlers ─────────────────────────────────────────────────────
  const accept = useCallback(async (a: MyAssignment) => {
    setActing(a.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/assignments/${a.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept' }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setActionError(j?.error ?? t('assignments.actionError'));
      } else {
        await fetchMine();
      }
    } catch {
      setActionError(t('assignments.actionError'));
    }
    setActing(null);
  }, [fetchMine, t]);

  const submitReject = useCallback(async () => {
    if (!rejectFor) return;
    setActing(rejectFor.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/assignments/${rejectFor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', rejection_reason: rejectReason.trim() || undefined }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setActionError(j?.error ?? t('assignments.actionError'));
      } else {
        setRejectFor(null);
        setRejectReason('');
        await fetchMine();
      }
    } catch {
      setActionError(t('assignments.actionError'));
    }
    setActing(null);
  }, [rejectFor, rejectReason, fetchMine, t]);

  // ── Render ──────────────────────────────────────────────────────────────
  if (!isAgent || !loaded) return null;

  const pending = data.live.filter((a) => a.status === 'pending')
    .sort((a, b) => (a.shift_date + a.scheduled_start_time).localeCompare(b.shift_date + b.scheduled_start_time));
  const active = data.live.filter((a) => a.status === 'accepted' || a.status === 'in_progress')
    .sort((a, b) => (a.shift_date + a.scheduled_start_time).localeCompare(b.shift_date + b.scheduled_start_time));
  const showWaiting =
    pending.length === 0 &&
    active.length === 0 &&
    data.recentRejected.length > 0;

  if (pending.length === 0 && active.length === 0 && !showWaiting) return null;

  const fmtDateLocal = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-6 pt-4 space-y-3">
      {/* ── Pending cards ───────────────────────────────────────────────── */}
      {pending.map((a) => (
        <div
          key={a.id}
          className="rounded-2xl border-2 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 shadow-md overflow-hidden"
        >
          <div className="px-4 py-2.5 bg-amber-400 dark:bg-amber-600 text-amber-950 dark:text-amber-50 text-sm font-bold flex items-center gap-2">
            <span>📋</span>
            <span>{t('assignments.cardPendingTitle')}</span>
          </div>
          <div className="p-4 space-y-2.5">
            {/* Store */}
            <div>
              <p className="text-base font-bold text-gray-900 dark:text-gray-100">
                {a.store?.name ?? '—'}
              </p>
              {a.store?.address && (
                <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">{a.store.address}</p>
              )}
            </div>

            {/* Date / time / duration */}
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
              <span className="text-gray-700 dark:text-gray-200">
                <span className="text-gray-500 dark:text-gray-400">{t('assignments.cardDate')}:</span>{' '}
                <strong className="capitalize">{fmtDateLocal(a.shift_date)}</strong>
              </span>
              <span className="text-gray-700 dark:text-gray-200">
                <span className="text-gray-500 dark:text-gray-400">{t('assignments.cardStartTime')}:</span>{' '}
                <strong className="tabular-nums">{a.scheduled_start_time.slice(0, 5)}</strong>
              </span>
              <span className="text-gray-700 dark:text-gray-200">
                <span className="text-gray-500 dark:text-gray-400">{t('assignments.cardDuration')}:</span>{' '}
                <strong>{Math.floor(a.expected_duration_min / 60)}h{a.expected_duration_min % 60 ? ` ${a.expected_duration_min % 60}m` : ''}</strong>
              </span>
            </div>

            {/* Assigned by */}
            {a.assigner?.name && (
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {t('assignments.cardAssignedBy')}: <span className="font-medium text-gray-700 dark:text-gray-200">{a.assigner.name}</span>
              </p>
            )}

            {actionError && (
              <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                {actionError}
              </p>
            )}

            {/* Action buttons — large tap targets */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => accept(a)}
                disabled={acting === a.id}
                className="py-3 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-60"
              >
                {acting === a.id ? '…' : `✓ ${t('assignments.acceptBtn')}`}
              </button>
              <button
                onClick={() => { setRejectFor(a); setRejectReason(''); }}
                disabled={acting === a.id}
                className="py-3 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 active:scale-[0.98] transition-all disabled:opacity-60"
              >
                ✕ {t('assignments.rejectBtn')}
              </button>
            </div>
          </div>
        </div>
      ))}

      {/* ── Active assignment card ──────────────────────────────────────── */}
      {active.map((a) => {
        const start = startDateTime(a);
        const isToday = a.shift_date === todayLocal();
        const dist = position && a.store
          ? Math.round(haversineMeters(position.lat, position.lng, a.store.latitude, a.store.longitude))
          : null;
        return (
          <div key={a.id} className="space-y-3">
          {/* Live progress card — sibling above the static details card */}
          <AssignmentProgressCard
            assignment={{
              id: a.id,
              status: a.status,
              shift_date: a.shift_date,
              scheduled_start_time: a.scheduled_start_time,
              expected_duration_min: a.expected_duration_min,
              actual_entry_at: a.actual_entry_at,
              effective_ms_now: a.effective_ms_now,
              last_event: a.last_event,
            }}
            liveDistanceMeters={dist}
            tick={tick}
          />
          <div
            className="rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-gray-900 shadow-md overflow-hidden"
          >
            <div className="px-4 py-2.5 bg-emerald-600 text-white text-sm font-bold flex items-center gap-2">
              <span>✅</span>
              <span>
                {isToday
                  ? t('assignments.cardActiveTitleToday')
                  : t('assignments.cardActiveTitleFuture').replace('{date}', fmtDateLocal(a.shift_date))}
              </span>
            </div>
            <div className="p-4 space-y-3">
              {/* Store + distance */}
              <div>
                <p className="text-base font-bold text-gray-900 dark:text-gray-100">
                  {a.store?.name ?? '—'}
                </p>
                {a.store?.address && (
                  <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">{a.store.address}</p>
                )}
                <p className="text-[11px] mt-1.5">
                  <span className="text-gray-500 dark:text-gray-400">{t('assignments.cardDistance')}:</span>{' '}
                  {dist != null ? (
                    <strong className="text-gray-800 dark:text-gray-200">{fmtDistance(dist)}</strong>
                  ) : (
                    <span className="text-gray-400 italic">{t('assignments.cardDistanceUnavailable')}</span>
                  )}
                </p>
              </div>

              {/* Countdown */}
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2.5">
                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                  ⏱️ <span className="font-semibold">{formatCountdown(start, t)}</span>
                </p>
                <p className="text-[10px] text-emerald-700/70 dark:text-emerald-300/70 mt-0.5">
                  {t('assignments.cardStartTime')}: <strong className="tabular-nums">{a.scheduled_start_time.slice(0, 5)}</strong>
                  {' · '}
                  {t('assignments.cardDuration')}: <strong>{Math.floor(a.expected_duration_min / 60)}h{a.expected_duration_min % 60 ? ` ${a.expected_duration_min % 60}m` : ''}</strong>
                </p>
              </div>

              {/* Maps button */}
              <button
                onClick={() => a.store && openMaps(a.store.address, a.store.latitude, a.store.longitude)}
                disabled={!a.store}
                className="w-full py-3 rounded-xl text-sm font-bold text-white transition-colors active:scale-[0.98]"
                style={{ backgroundColor: 'var(--primary)' }}
                aria-label={t('assignments.cardOpenMaps')}
              >
                🗺️ {t('assignments.cardOpenMaps')}
              </button>

              {/* Keep-app-open reminder + tracker controller (today only) */}
              {isToday && a.store && (
                <>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 text-center leading-snug">
                    💡 {t('assignments.keepAppOpenHint')}
                  </p>
                  <AssignmentTracker
                    assignment={{
                      id: a.id,
                      shift_date: a.shift_date,
                      store: { latitude: a.store.latitude, longitude: a.store.longitude },
                    }}
                  />
                </>
              )}
            </div>
          </div>
          </div>
        );
      })}

      {/* ── Waiting-for-new-assignment notice ───────────────────────────── */}
      {showWaiting && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 px-4 py-3 flex items-start gap-3">
          <span className="text-xl flex-shrink-0">⏳</span>
          <div>
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {t('assignments.waitingTitle')}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              {t('assignments.waitingBody')}
            </p>
          </div>
        </div>
      )}

      {/* ── Reject modal ────────────────────────────────────────────────── */}
      {rejectFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">
              {t('assignments.rejectModalTitle')}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              {t('assignments.rejectModalBody')}
            </p>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
              {t('assignments.rejectReasonLabel')} <span className="font-normal lowercase">({t('common.optional')})</span>
            </label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t('assignments.rejectReasonPlaceholder')}
              maxLength={500}
              rows={3}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm"
            />
            {actionError && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                {actionError}
              </p>
            )}
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => { setRejectFor(null); setRejectReason(''); setActionError(null); }}
                disabled={acting === rejectFor.id}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-60"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={submitReject}
                disabled={acting === rejectFor.id}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60"
              >
                {acting === rejectFor.id ? '…' : t('assignments.confirmRejectBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
