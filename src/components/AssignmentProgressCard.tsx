'use client';
import { useMemo } from 'react';
import { useLanguage } from './LanguageContext';
import { fmtDistance } from '@/lib/geo';
import { fmtTime } from '@/lib/i18n';
import {
  punctualityForEntry,
  liveStatusBeforeEntry,
  type Punctuality,
  type LivePunctuality,
  type GeofenceEventType,
} from '@/lib/assignmentGeofence';

interface LastEvent {
  event_type: GeofenceEventType;
  occurred_at: string;
  distance_meters: number | null;
}

interface AssignmentForProgress {
  id: string;
  status: 'accepted' | 'in_progress' | 'completed' | 'incomplete' | 'cancelled' | 'cancelled_in_progress' | 'pending' | 'rejected';
  shift_date: string;
  scheduled_start_time: string;
  expected_duration_min: number;
  actual_entry_at: string | null;
  effective_ms_now: number;
  last_event: LastEvent | null;
}

interface Props {
  assignment: AssignmentForProgress;
  /** Live distance from the geolocation watch in AssignmentTracker. */
  liveDistanceMeters: number | null;
  /** Forces re-render every minute. */
  tick: number;
  /** Epoch ms of the last successful /api/assignments/my fetch. The live
   *  elapsed time is computed as effective_ms_now + (now - fetchedAt). */
  fetchedAt: number;
}

const formatHHMM = (ms: number) => {
  if (ms <= 0) return '00:00';
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

type ProgressState = 'pendingArrival' | 'inProgress' | 'tempExit' | 'finalExit' | 'completed';

function deriveState(a: AssignmentForProgress): ProgressState {
  if (a.status === 'completed' || a.status === 'incomplete') return 'completed';
  if (a.status === 'accepted') return 'pendingArrival';
  // in_progress
  if (a.last_event?.event_type === 'exited_warn') return 'tempExit';
  if (a.last_event?.event_type === 'exited_final') return 'finalExit';
  return 'inProgress';
}

/**
 * Punctuality bucket for the progress card. Delegates to the centralized
 * functions in lib/assignmentGeofence so the 5-bucket post-entry table and
 * the 3-bucket pre-entry table never drift between server and client.
 */
type ProgressPunctuality = Punctuality | LivePunctuality;
function derivePunctuality(a: AssignmentForProgress): ProgressPunctuality {
  if (a.actual_entry_at) {
    return punctualityForEntry({
      shift_date: a.shift_date,
      scheduled_start_time: a.scheduled_start_time,
      actual_entry_at: a.actual_entry_at,
    });
  }
  return liveStatusBeforeEntry({
    shift_date: a.shift_date,
    scheduled_start_time: a.scheduled_start_time,
  });
}

export default function AssignmentProgressCard({ assignment: a, liveDistanceMeters, tick, fetchedAt }: Props) {
  const { t, lang } = useLanguage();

  // Live elapsed: when the assignment is in_progress, add the wall-clock
  // time elapsed since the fetch to the server's snapshot. `tick` exists
  // only as a re-render trigger; the actual math uses Date.now() so the
  // value resets exactly when fetchedAt updates and never drifts past the
  // last refetch.
  const elapsedMs = useMemo(() => {
    void tick; // re-render trigger only
    const state = deriveState(a);
    if (state !== 'inProgress') return a.effective_ms_now;
    return a.effective_ms_now + Math.max(0, Date.now() - fetchedAt);
  }, [a, fetchedAt, tick]);

  const expectedMs = a.expected_duration_min * 60_000;
  const progressPct = Math.max(0, Math.min(100, Math.round((elapsedMs / expectedMs) * 100)));
  const remainingMs = Math.max(0, expectedMs - elapsedMs);

  const state = deriveState(a);
  const punctuality = derivePunctuality(a);

  // ── State header config ────────────────────────────────────────────────
  const STATE_CFG: Record<ProgressState, { label: string; color: string; bg: string; emoji: string }> = {
    pendingArrival: {
      label: t('assignments.progressStatePendingArrival'),
      color: 'text-sky-700 dark:text-sky-300',
      bg: 'bg-sky-100 dark:bg-sky-900/30 border-sky-300 dark:border-sky-800',
      emoji: '⏳',
    },
    inProgress: {
      label: t('assignments.progressStateInProgress'),
      color: 'text-blue-700 dark:text-blue-300',
      bg: 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-800',
      emoji: '✅',
    },
    tempExit: {
      label: t('assignments.progressStateTempExit'),
      color: 'text-amber-700 dark:text-amber-300',
      bg: 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-800',
      emoji: '⚠️',
    },
    finalExit: {
      label: t('assignments.progressStateFinalExit'),
      color: 'text-red-700 dark:text-red-300',
      bg: 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-800',
      emoji: '🛑',
    },
    completed: {
      label: t('assignments.progressStateCompleted'),
      color: 'text-gray-700 dark:text-gray-200',
      bg: 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700',
      emoji: '🏁',
    },
  };
  const cfg = STATE_CFG[state];

  const PUNCT_CFG: Record<ProgressPunctuality, { color: string; label: string }> = {
    on_time:           { color: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300', label: '✓ ' + t('assignments.punctualityOnTime') },
    late:              { color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300', label: t('assignments.punctualityLate') },
    late_arrival:      { color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300', label: t('assignments.punctualityLateArrival') },
    late_severe:       { color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300', label: t('assignments.punctualityLateSevere') },
    no_show:           { color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300', label: t('assignments.punctualityNoShow') },
    pending_arrival:   { color: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300', label: t('assignments.punctualityPendingArrival') },
    awaiting_arrival:  { color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300', label: t('assignments.punctualityAwaitingArrival') },
  };
  const punctCfg = PUNCT_CFG[punctuality];

  const fmtT = (iso: string) => fmtTime(iso, lang);

  // ── Optional contextual messages per state ─────────────────────────────
  const contextMessage =
    state === 'tempExit' ? t('assignments.progressMsgTempExit')
    : state === 'finalExit' ? t('assignments.progressMsgFinalExit')
    : null;
  // "Reactivado" message: completed → if last event is reentered, show it;
  // here we show it as a tooltip subtitle below the header for in_progress
  // when the state had previously been finalExit. Detecting that requires
  // the events array; we leave it implicit for now.

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-md overflow-hidden">
      {/* Header — state */}
      <div className={`px-4 py-2.5 border-b ${cfg.bg} flex items-center justify-between gap-2`}>
        <div className="flex items-center gap-2 min-w-0">
          <span aria-hidden>{cfg.emoji}</span>
          <span className={`text-sm font-bold ${cfg.color} truncate`}>{cfg.label}</span>
        </div>
        {punctuality !== 'pending_arrival' && (
          <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap ${punctCfg.color}`}>
            {punctCfg.label}
          </span>
        )}
      </div>

      <div className="p-4 space-y-3">
        {/* Big elapsed time */}
        <div className="text-center">
          <p className="text-3xl sm:text-4xl font-mono font-extrabold text-gray-900 dark:text-gray-100 tabular-nums tracking-wider">
            {formatHHMM(elapsedMs)}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mt-0.5">
            {t('assignments.progressElapsed')}
            <span className="ml-1 text-gray-400">/ {Math.floor(a.expected_duration_min / 60)}h{a.expected_duration_min % 60 ? ` ${a.expected_duration_min % 60}m` : ''}</span>
          </p>
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div
              className={`h-full transition-all ${
                progressPct >= 100 ? 'bg-emerald-500' :
                state === 'tempExit' ? 'bg-amber-400' :
                state === 'finalExit' ? 'bg-red-400' :
                'bg-[var(--primary)]'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400 tabular-nums">
            <span>{progressPct}%</span>
            {state === 'inProgress' && remainingMs > 0 && (
              <span>{t('assignments.progressRemaining').replace('{time}', formatHHMM(remainingMs))}</span>
            )}
          </div>
        </div>

        {/* Detail row: actual entry + distance */}
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 px-2.5 py-1.5">
            <p className="text-[9px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t('assignments.progressActualEntry')}
            </p>
            <p className="font-bold text-gray-800 dark:text-gray-100 tabular-nums">
              {a.actual_entry_at ? fmtT(a.actual_entry_at) : <span className="text-gray-400">—</span>}
            </p>
          </div>
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 px-2.5 py-1.5">
            <p className="text-[9px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t('assignments.cardDistance')}
            </p>
            <p className="font-bold text-gray-800 dark:text-gray-100 tabular-nums">
              {liveDistanceMeters != null
                ? fmtDistance(liveDistanceMeters)
                : a.last_event?.distance_meters != null
                  ? fmtDistance(a.last_event.distance_meters)
                  : <span className="text-gray-400">—</span>}
            </p>
          </div>
        </div>

        {/* Context message */}
        {contextMessage && (
          <p className={`text-[11px] rounded-lg px-3 py-2 leading-snug ${
            state === 'tempExit'
              ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
          }`}>
            {contextMessage}
          </p>
        )}
      </div>
    </div>
  );
}
