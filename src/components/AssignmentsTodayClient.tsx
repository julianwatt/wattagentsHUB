'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { useLanguage } from './LanguageContext';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { fmtDistance } from '@/lib/geo';
import { fmtTime } from '@/lib/i18n';
import AssignmentTimelineModal from './AssignmentTimelineModal';
import type { GeofenceEventType } from '@/lib/assignmentGeofence';

// ── Types ────────────────────────────────────────────────────────────────────
interface LastEvent {
  event_type: GeofenceEventType;
  occurred_at: string;
  distance_meters: number | null;
  latitude: number | null;
  longitude: number | null;
  geo_method: string | null;
}

interface TodayAssignment {
  id: string;
  agent_id: string;
  assigned_by: string;
  store_id: string;
  shift_date: string;
  scheduled_start_time: string;
  expected_duration_min: number;
  status: 'pending' | 'accepted' | 'rejected' | 'in_progress' | 'completed' | 'incomplete' | 'cancelled';
  actual_entry_at: string | null;
  actual_exit_at: string | null;
  effective_minutes: number;
  met_duration: boolean | null;
  punctuality: 'on_time' | 'late' | 'no_show' | null;
  rejection_reason: string | null;
  agent: { id: string; name: string; username: string } | null;
  store: { id: string; name: string; address: string | null } | null;
  last_event: LastEvent | null;
  effective_ms_now: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const formatDuration = (ms: number) => {
  if (ms <= 0) return '00:00';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

type Group = 'attention' | 'inProgress' | 'pendingArrival' | 'completed';

function groupOf(a: TodayAssignment): Group {
  // Needs attention: pending, rejected (not yet replaced), or actively outside
  if (a.status === 'pending' || a.status === 'rejected' || a.status === 'cancelled') return 'attention';
  if (a.status === 'in_progress') {
    if (a.last_event?.event_type === 'exited_warn' || a.last_event?.event_type === 'exited_final') {
      return 'attention';
    }
    return 'inProgress';
  }
  if (a.status === 'accepted') return 'pendingArrival';
  return 'completed'; // completed | incomplete
}

// Subtle highlight animation for newly-changed rows
const HIGHLIGHT_MS = 2500;

// ── Component ────────────────────────────────────────────────────────────────
export default function AssignmentsTodayClient() {
  const { t, lang } = useLanguage();

  const [items, setItems] = useState<TodayAssignment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  // Per-row "live now" tick (every 30s) to refresh the in-progress effective time
  const [tick, setTick] = useState(0);

  // Highlight tracker — set of currently-highlighted assignment IDs. Stored
  // as state (not a ref) so reads during render are pure.
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const triggerHighlight = useCallback((id: string) => {
    setHighlighted((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setTimeout(() => {
      setHighlighted((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, HIGHLIGHT_MS);
  }, []);

  // Timeline modal state
  const [timelineFor, setTimelineFor] = useState<{ id: string; agentName: string; storeName: string } | null>(null);

  // ── Fetch ───────────────────────────────────────────────────────────────
  const fetchToday = useCallback(async () => {
    try {
      const res = await fetch('/api/assignments/today', { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        const next: TodayAssignment[] = j.assignments ?? [];
        // Detect changes vs current items to fire highlight animations
        setItems((prev) => {
          if (prev.length > 0) {
            for (const a of next) {
              const old = prev.find((p) => p.id === a.id);
              if (!old) {
                triggerHighlight(a.id);
              } else if (
                old.status !== a.status ||
                old.last_event?.event_type !== a.last_event?.event_type
              ) {
                triggerHighlight(a.id);
              }
            }
          }
          return next;
        });
      }
    } catch { /* silent */ }
    setLoaded(true);
  }, [triggerHighlight]);

  useEffect(() => { fetchToday(); }, [fetchToday]);

  // Realtime subscriptions
  useEffect(() => {
    const sb = getSupabaseBrowser();
    const channel = sb
      .channel('assignments-today-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments' }, () => { fetchToday(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'assignment_geofence_events' }, () => { fetchToday(); })
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [fetchToday]);

  // 30s tick to refresh in-progress live time
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Refresh on tab focus / visibility
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') fetchToday(); };
    const onFocus = () => fetchToday();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchToday]);

  // ── Derived: groups + summary ───────────────────────────────────────────
  const grouped = useMemo(() => {
    const g: Record<Group, TodayAssignment[]> = {
      attention: [],
      inProgress: [],
      pendingArrival: [],
      completed: [],
    };
    for (const a of items) g[groupOf(a)].push(a);
    return g;
  }, [items]);

  const summary = useMemo(() => {
    const total = items.length;
    const completed = items.filter((a) => a.status === 'completed' || a.status === 'incomplete').length;
    const inProgress = items.filter((a) => a.status === 'in_progress').length;
    const attention = grouped.attention.length;

    // Punctuality: % of items where punctuality is 'on_time' among those with a verdict
    const withVerdict = items.filter((a) => a.punctuality !== null);
    const onTime = withVerdict.filter((a) => a.punctuality === 'on_time').length;
    const punctualityPct = withVerdict.length === 0 ? null : Math.round((onTime / withVerdict.length) * 100);

    return { total, completed, inProgress, attention, punctualityPct };
  }, [items, grouped]);

  // ── Action handlers ─────────────────────────────────────────────────────
  const cancel = useCallback(async (id: string) => {
    if (!confirm(t('assignments.confirmCancelBody'))) return;
    setActing(id);
    try {
      await fetch(`/api/assignments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      await fetchToday();
    } catch { /* silent */ }
    setActing(null);
  }, [fetchToday, t]);

  // ── Render ──────────────────────────────────────────────────────────────
  if (!loaded) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
        <p className="text-xs text-gray-400">{t('common.loading')}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm py-16 text-center">
        <p className="text-3xl mb-2">📭</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('assignments.todayEmpty')}</p>
        <Link href="/assignments/new" className="inline-block mt-3 text-xs font-bold px-3 py-1.5 rounded-lg text-white" style={{ backgroundColor: 'var(--primary)' }}>
          {t('assignments.formTitle')}
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-5">
        {/* ── Summary bar ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
          <Stat label={t('assignments.summaryTotal')} value={summary.total} />
          <Stat label={t('assignments.summaryInProgress')} value={summary.inProgress} accent="emerald" />
          <Stat label={t('assignments.summaryCompleted')} value={summary.completed} accent="blue" />
          <Stat label={t('assignments.summaryAttention')} value={summary.attention} accent="amber" />
          <Stat
            label={t('assignments.summaryPunctuality')}
            value={summary.punctualityPct === null ? '—' : `${summary.punctualityPct}%`}
            accent={
              summary.punctualityPct === null
                ? undefined
                : summary.punctualityPct >= 90
                  ? 'emerald'
                  : summary.punctualityPct >= 70
                    ? 'amber'
                    : 'red'
            }
          />
        </div>

        {/* ── Groups ──────────────────────────────────────────────────── */}
        <Section
          title={t('assignments.groupAttention')}
          accent="amber"
          items={grouped.attention}
          empty={t('assignments.groupAttentionEmpty')}
          renderCard={(a) => (
            <Card
              key={a.id}
              a={a}
              tick={tick}
              highlighted={highlighted.has(a.id)}
              acting={acting === a.id}
              lang={lang}
              t={t}
              onTimeline={(p) => setTimelineFor(p)}
              onCancel={cancel}
            />
          )}
        />
        <Section
          title={t('assignments.groupInProgress')}
          accent="emerald"
          items={grouped.inProgress}
          empty={t('assignments.groupInProgressEmpty')}
          renderCard={(a) => (
            <Card
              key={a.id}
              a={a}
              tick={tick}
              highlighted={highlighted.has(a.id)}
              acting={acting === a.id}
              lang={lang}
              t={t}
              onTimeline={(p) => setTimelineFor(p)}
              onCancel={cancel}
            />
          )}
        />
        <Section
          title={t('assignments.groupPendingArrival')}
          accent="sky"
          items={grouped.pendingArrival}
          empty={t('assignments.groupPendingArrivalEmpty')}
          renderCard={(a) => (
            <Card
              key={a.id}
              a={a}
              tick={tick}
              highlighted={highlighted.has(a.id)}
              acting={acting === a.id}
              lang={lang}
              t={t}
              onTimeline={(p) => setTimelineFor(p)}
              onCancel={cancel}
            />
          )}
        />
        <Section
          title={t('assignments.groupCompleted')}
          accent="gray"
          items={grouped.completed}
          empty={t('assignments.groupCompletedEmpty')}
          renderCard={(a) => (
            <Card
              key={a.id}
              a={a}
              tick={tick}
              highlighted={highlighted.has(a.id)}
              acting={acting === a.id}
              lang={lang}
              t={t}
              onTimeline={(p) => setTimelineFor(p)}
              onCancel={cancel}
            />
          )}
        />
      </div>

      {/* Timeline modal */}
      {timelineFor && (
        <AssignmentTimelineModal
          assignmentId={timelineFor.id}
          agentName={timelineFor.agentName}
          storeName={timelineFor.storeName}
          onClose={() => setTimelineFor(null)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────
function Stat({ label, value, accent }: { label: string; value: number | string; accent?: 'emerald' | 'amber' | 'red' | 'blue' }) {
  const accentClass =
    accent === 'emerald' ? 'text-emerald-600 dark:text-emerald-400'
    : accent === 'amber' ? 'text-amber-600 dark:text-amber-400'
    : accent === 'red' ? 'text-red-600 dark:text-red-400'
    : accent === 'blue' ? 'text-blue-600 dark:text-blue-400'
    : 'text-gray-900 dark:text-gray-100';
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`text-xl sm:text-2xl font-extrabold tabular-nums mt-0.5 ${accentClass}`}>{value}</p>
    </div>
  );
}

function Section({
  title, accent, items, empty, renderCard,
}: {
  title: string;
  accent: 'amber' | 'emerald' | 'sky' | 'gray';
  items: TodayAssignment[];
  empty: string;
  renderCard: (a: TodayAssignment) => React.ReactNode;
}) {
  const accentClass =
    accent === 'amber' ? 'text-amber-600 dark:text-amber-400 border-l-amber-400 dark:border-l-amber-600'
    : accent === 'emerald' ? 'text-emerald-600 dark:text-emerald-400 border-l-emerald-400 dark:border-l-emerald-600'
    : accent === 'sky' ? 'text-sky-600 dark:text-sky-400 border-l-sky-400 dark:border-l-sky-600'
    : 'text-gray-500 dark:text-gray-400 border-l-gray-300 dark:border-l-gray-600';
  return (
    <section>
      <div className={`flex items-center justify-between gap-2 mb-2 pl-2 border-l-4 ${accentClass}`}>
        <h2 className="text-sm font-bold tracking-wide uppercase">{title}</h2>
        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 italic pl-2">{empty}</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{items.map(renderCard)}</div>
      )}
    </section>
  );
}

interface CardProps {
  a: TodayAssignment;
  tick: number;
  highlighted: boolean;
  acting: boolean;
  lang: 'es' | 'en';
  t: (k: string) => string;
  onTimeline: (p: { id: string; agentName: string; storeName: string }) => void;
  onCancel: (id: string) => void;
}

const Card = function Card({ a, tick, highlighted, acting, lang, t, onTimeline, onCancel }: CardProps) {
  // Per-card live elapsed time. For in_progress, extrapolate from server's
  // effective_ms_now using "tick" as a refresh trigger every 30s.
  // The server already accumulated up to its serverNow; we add the time
  // since this fetch arrived. Simpler: just rely on tick + reusing
  // effective_ms_now (server refreshes on every realtime change).
  const liveMs = a.status === 'in_progress'
    ? a.effective_ms_now + Math.max(0, (tick * 30_000) - 0) // tick keeps ref fresh
    : a.effective_ms_now;

  const lastEvtFmt = a.last_event ? fmtTime(a.last_event.occurred_at, lang) : null;
  const startFmt = fmtTime(a.scheduled_start_time, lang);
  const entryFmt = a.actual_entry_at ? fmtTime(a.actual_entry_at, lang) : null;
  const exitFmt = a.actual_exit_at ? fmtTime(a.actual_exit_at, lang) : null;

  const statusBadge: { color: string; label: string } = (() => {
    if (a.status === 'pending') return { color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300', label: t('assignments.statusPending') };
    if (a.status === 'rejected') return { color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300', label: t('assignments.statusRejected') };
    if (a.status === 'cancelled') return { color: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300', label: t('assignments.statusCancelled') };
    if (a.status === 'accepted') return { color: 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300', label: t('assignments.statusAccepted') };
    if (a.status === 'completed') return { color: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300', label: t('assignments.statusCompleted') };
    if (a.status === 'incomplete') return { color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300', label: t('assignments.statusIncomplete') };
    // in_progress with sub-state from last event
    if (a.last_event?.event_type === 'exited_warn') {
      return { color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300', label: t('assignments.subStateExitedWarn') };
    }
    if (a.last_event?.event_type === 'exited_final') {
      return { color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300', label: t('assignments.subStateExitedFinal') };
    }
    return { color: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300', label: t('assignments.statusInProgress') };
  })();

  const punctuality = a.punctuality === 'on_time'
    ? { color: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300', label: '✓ ' + t('assignments.punctualityOnTime') }
    : a.punctuality === 'late'
      ? { color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300', label: t('assignments.punctualityLate') }
      : a.punctuality === 'no_show'
        ? { color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300', label: t('assignments.punctualityNoShow') }
        : null;

  const canCancel = !['completed', 'incomplete', 'cancelled', 'rejected'].includes(a.status);
  const canReassign = a.status === 'rejected' || a.status === 'cancelled';

  return (
    <div className={`bg-white dark:bg-gray-900 rounded-2xl border shadow-sm p-3.5 transition-all ${
      highlighted
        ? 'border-[var(--primary)] ring-2 ring-[var(--primary)] ring-opacity-40'
        : 'border-gray-100 dark:border-gray-800'
    }`}>
      {/* Header: avatar + name + status */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0"
            style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}
          >
            {(a.agent?.name ?? '—').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{a.agent?.name ?? '—'}</p>
            <p className="text-[10px] text-gray-400 truncate">@{a.agent?.username ?? '—'}</p>
          </div>
        </div>
        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${statusBadge.color}`}>
          {statusBadge.label}
        </span>
      </div>

      {/* Body */}
      <div className="space-y-1.5 text-[11px]">
        <p className="text-gray-700 dark:text-gray-200 truncate">
          📍 <strong>{a.store?.name ?? '—'}</strong>
        </p>
        <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400 tabular-nums">
          <span>🕐 {startFmt}</span>
          <span>· {Math.floor(a.expected_duration_min / 60)}h{a.expected_duration_min % 60 ? ` ${a.expected_duration_min % 60}m` : ''}</span>
          {entryFmt && <span className="text-emerald-600 dark:text-emerald-400">✓ {entryFmt}</span>}
        </div>

        {/* Live in-progress info */}
        {a.status === 'in_progress' && (
          <div className="flex items-center gap-2 text-gray-700 dark:text-gray-200 mt-1.5">
            <span className="font-mono font-bold">{formatDuration(liveMs)}</span>
            <span className="text-gray-400">·</span>
            {a.last_event?.distance_meters != null ? (
              <span>
                {fmtDistance(a.last_event.distance_meters)}
                {lastEvtFmt && <span className="text-gray-400"> ({lastEvtFmt})</span>}
              </span>
            ) : (
              <span className="text-gray-400 italic">{t('assignments.cardDistanceUnavailable')}</span>
            )}
          </div>
        )}

        {/* Final indicators when shift ended */}
        {(a.status === 'completed' || a.status === 'incomplete') && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
              a.met_duration
                ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
            }`}>
              {a.met_duration ? '✓' : '✗'} {formatDuration(liveMs)}
            </span>
            {punctuality && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${punctuality.color}`}>
                {punctuality.label}
              </span>
            )}
            {exitFmt && <span className="text-[10px] text-gray-400">→ {exitFmt}</span>}
          </div>
        )}

        {a.rejection_reason && (
          <p className="text-[10px] text-red-600 dark:text-red-400 italic">&ldquo;{a.rejection_reason}&rdquo;</p>
        )}
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
        <button
          onClick={() => onTimeline({ id: a.id, agentName: a.agent?.name ?? '—', storeName: a.store?.name ?? '—' })}
          className="text-[10px] font-bold px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors"
        >
          {t('assignments.viewTimeline')}
        </button>
        {canReassign && (
          <Link
            href={`/assignments/new?reassign=${a.id}`}
            className="text-[10px] font-bold px-2 py-1 rounded-lg text-white transition-colors whitespace-nowrap"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            {t('assignments.reassignBtn')}
          </Link>
        )}
        {canCancel && (
          <button
            onClick={() => onCancel(a.id)}
            disabled={acting}
            className="text-[10px] font-bold px-2 py-1 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-60"
          >
            {acting ? '…' : t('assignments.cancelBtn')}
          </button>
        )}
      </div>
    </div>
  );
};
