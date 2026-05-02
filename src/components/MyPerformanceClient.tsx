'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useLanguage } from './LanguageContext';
import { fmtTime as fmtTimeI18n } from '@/lib/i18n';
import AssignmentCards from './AssignmentCards';
import AssignmentTimelineModal from './AssignmentTimelineModal';
import { formatStoreLabel } from '@/lib/stores';

interface Props { role: string; }

// ── Types ────────────────────────────────────────────────────────────────────
interface CancelledByUser { id: string; name: string; role: string }

interface MyHistoryRow {
  id: string;
  agent_id: string;
  store_id: string;
  shift_date: string;
  scheduled_start_time: string;
  expected_duration_min: number;
  actual_entry_at: string | null;
  actual_exit_at: string | null;
  effective_minutes: number;
  /** Present only when status === 'in_progress'. Server-computed up to its
   *  serverNow; client extrapolates with (Date.now() - fetchedAt). */
  effective_ms_now?: number;
  met_duration: boolean | null;
  punctuality: 'on_time' | 'late' | 'no_show' | null;
  status: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancelled_by_user?: CancelledByUser | null;
  store: { id: string; name: string; address: string | null } | null;
}

function endedByLabel(
  row: { status: string; actual_entry_at: string | null; cancelled_by_user?: CancelledByUser | null },
  t: (k: string) => string,
): string | null {
  if (row.status !== 'cancelled' || !row.cancelled_by_user) return null;
  if (!row.actual_entry_at) return null;
  const role = row.cancelled_by_user.role;
  if (role === 'admin') return t('assignments.endedByAdmin');
  if (role === 'ceo')   return t('assignments.endedByCeo');
  return t('assignments.endedByGeneric');
}

interface SummaryShape {
  total: number;
  capped: boolean;
  met_rate: number;
  punctuality_rate: number;
  total_minutes: number;
  avg_effective_minutes: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const todayLocal = (): string => new Date().toISOString().slice(0, 10);
const daysAgoLocal = (n: number): string =>
  new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);

function formatHHMM(min: number): string {
  if (min <= 0) return '00:00';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatHHMMFromMs(ms: number): string {
  return formatHHMM(Math.max(0, Math.floor(ms / 60000)));
}

const DURATION_BUCKETS = ['met', 'partial', 'unmet'] as const;

// ── Component ────────────────────────────────────────────────────────────────
export default function MyPerformanceClient({ role }: Props) {
  const { t, lang } = useLanguage();

  const [from, setFrom] = useState(daysAgoLocal(30));
  const [to, setTo] = useState(todayLocal());
  const [durationFilter, setDurationFilter] = useState<Set<string>>(new Set());

  const [rows, setRows] = useState<MyHistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [loading, setLoading] = useState(false);

  // Live-tick for in-progress rows (mirrors AssignmentsHistoryClient).
  const [fetchedAt, setFetchedAt] = useState<number>(() => Date.now());
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const [summary, setSummary] = useState<SummaryShape | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [detailFor, setDetailFor] = useState<MyHistoryRow | null>(null);

  const queryParams = useMemo(() => {
    const sp = new URLSearchParams();
    if (from) sp.set('from', from);
    if (to) sp.set('to', to);
    if (durationFilter.size > 0) sp.set('duration', Array.from(durationFilter).join(','));
    return sp;
  }, [from, to, durationFilter]);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams(queryParams);
      sp.set('page', String(page));
      sp.set('pageSize', String(pageSize));
      const res = await fetch(`/api/assignments/my-history?${sp.toString()}`, { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        setRows(j.assignments ?? []);
        setTotal(j.total ?? 0);
        setFetchedAt(Date.now());
      }
    } catch { /* silent */ }
    setLoading(false);
  }, [queryParams, page]);

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const res = await fetch(`/api/assignments/my-history/summary?${queryParams.toString()}`, { cache: 'no-store' });
      if (res.ok) setSummary(await res.json());
    } catch { /* silent */ }
    setSummaryLoading(false);
  }, [queryParams]);

  useEffect(() => { setPage(1); }, [queryParams]);
  useEffect(() => { fetchPage(); }, [fetchPage]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const toggleDuration = (v: string) =>
    setDurationFilter((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v); else next.add(v);
      return next;
    });

  const resetFilters = () => {
    setFrom(daysAgoLocal(30));
    setTo(todayLocal());
    setDurationFilter(new Set());
  };

  const fmtDate = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
  const fmtTime = (iso: string | null) => fmtTimeI18n(iso, lang);

  const durationBadge = (r: MyHistoryRow) => {
    if (r.met_duration === true) return <Badge color="emerald">✓ {t('assignments.complianceMet')}</Badge>;
    if (r.met_duration === false && r.effective_minutes > 0) return <Badge color="amber">~ {t('assignments.compliancePartial')}</Badge>;
    if (r.met_duration === false) return <Badge color="red">✗ {t('assignments.complianceUnmet')}</Badge>;
    return <span className="text-[10px] text-gray-400">—</span>;
  };
  const punctualityBadge = (p: MyHistoryRow['punctuality']) => {
    if (p === 'on_time') return <Badge color="emerald">{t('assignments.punctualityOnTime')}</Badge>;
    if (p === 'late')    return <Badge color="amber">{t('assignments.punctualityLate')}</Badge>;
    if (p === 'no_show') return <Badge color="red">{t('assignments.punctualityNoShow')}</Badge>;
    return <span className="text-[10px] text-gray-400">—</span>;
  };
  const rowTint = (r: MyHistoryRow) => {
    if (r.met_duration === true) return 'bg-emerald-50/50 dark:bg-emerald-900/10';
    if (r.met_duration === false && r.effective_minutes > 0) return 'bg-amber-50/50 dark:bg-amber-900/10';
    if (r.met_duration === false) return 'bg-red-50/50 dark:bg-red-900/10';
    return '';
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('myPerformance.title')}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          {t('myPerformance.subtitle')}
        </p>
      </div>

      {/* Live assignment cards (pending / accepted / in-progress / waiting).
          Self-gates on role and renders nothing when there's no live work. */}
      <AssignmentCards role={role} />

      {/* Summary */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-3 sm:p-4">
        {summaryLoading || !summary ? (
          <p className="text-xs text-gray-400">{t('common.loading')}</p>
        ) : summary.total === 0 ? (
          <div className="py-10 text-center">
            <p className="text-3xl mb-2">🌱</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('myPerformance.empty')}</p>
            <p className="text-[11px] text-gray-400 mt-1">{t('myPerformance.emptyHint')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <Kpi label={t('myPerformance.kpiTotal')} value={summary.total.toString()} />
            <Kpi label={t('myPerformance.kpiCompliance')} value={`${summary.met_rate}%`} bar={summary.met_rate} accent="emerald" />
            <Kpi label={t('myPerformance.kpiPunctuality')} value={`${summary.punctuality_rate}%`} bar={summary.punctuality_rate} accent="blue" />
            <Kpi label={t('myPerformance.kpiTotalTime')} value={formatHHMM(summary.total_minutes)} />
            <Kpi label={t('myPerformance.kpiAvgTime')} value={formatHHMM(summary.avg_effective_minutes)} />
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('assignments.filters')}</h3>
          <button
            onClick={resetFilters}
            className="text-[11px] font-semibold hover:underline"
            style={{ color: 'var(--primary)' }}
          >
            {t('assignments.clearFilters')}
          </button>
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{t('assignments.filterFrom')}</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{t('assignments.filterTo')}</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{t('assignments.filterDuration')}</p>
          <div className="flex flex-wrap gap-1.5">
            {DURATION_BUCKETS.map((b) => {
              const active = durationFilter.has(b);
              return (
                <button
                  key={b}
                  onClick={() => toggleDuration(b)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                    active
                      ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary-light)]'
                      : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
                  }`}
                >
                  {b === 'met' ? t('assignments.complianceMet')
                  : b === 'partial' ? t('assignments.compliancePartial')
                  : t('assignments.complianceUnmet')}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[720px]">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <Th>{t('assignments.colDate')}</Th>
                <Th>{t('assignments.colStore')}</Th>
                <Th>{t('assignments.colScheduled')}</Th>
                <Th>{t('assignments.colActualEntry')}</Th>
                <Th>{t('assignments.colActualExit')}</Th>
                <Th align="right">{t('assignments.colEffective')}</Th>
                <Th>{t('assignments.colCompliance')}</Th>
                <Th>{t('assignments.colPunctuality')}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-xs text-gray-400">{t('common.loading')}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-xs text-gray-400">{t('assignments.tableEmpty')}</td></tr>
              ) : rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setDetailFor(r)}
                  className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors ${rowTint(r)}`}
                >
                  <td className="px-3 py-2.5 tabular-nums text-gray-700 dark:text-gray-200 whitespace-nowrap">{fmtDate(r.shift_date)}</td>
                  <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300">{r.store ? formatStoreLabel(r.store) : '—'}</td>
                  <td className="px-3 py-2.5 tabular-nums text-gray-700 dark:text-gray-200">{fmtTimeI18n(r.scheduled_start_time, lang)}</td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {r.actual_entry_at ? (
                      <span className="text-emerald-600 dark:text-emerald-400">{fmtTime(r.actual_entry_at)}</span>
                    ) : (
                      <span className="text-red-500 dark:text-red-400">{t('assignments.didNotArrive')}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-gray-600 dark:text-gray-300">{fmtTime(r.actual_exit_at)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-right font-mono">
                    {r.status === 'in_progress' && typeof r.effective_ms_now === 'number' ? (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {formatHHMMFromMs(r.effective_ms_now + Math.max(0, Date.now() - fetchedAt))}
                        <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" aria-label="live" />
                      </span>
                    ) : (
                      formatHHMM(r.effective_minutes)
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col gap-1 items-start">
                      {durationBadge(r)}
                      {endedByLabel(r, t) && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 whitespace-nowrap">
                          ⏹ {endedByLabel(r, t)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">{punctualityBadge(r.punctuality)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30 transition-colors"
            >
              {t('shift.adminPrev')}
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400">{page} {t('shift.adminPageOf')} {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30 transition-colors"
            >
              {t('shift.adminNext')}
            </button>
          </div>
        )}
      </div>

      {/* Detail modal — agent can only open assignments they own (server enforces) */}
      {detailFor && (
        <AssignmentTimelineModal
          assignmentId={detailFor.id}
          agentName={t('myPerformance.youLabel')}
          storeName={detailFor.store ? formatStoreLabel(detailFor.store) : '—'}
          onClose={() => setDetailFor(null)}
        />
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────
type Color = 'emerald' | 'red' | 'amber' | 'blue';

function Badge({ color, children }: { color: Color; children: React.ReactNode }) {
  const cls = {
    emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
    red:     'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    amber:   'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    blue:    'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  }[color];
  return <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap ${cls}`}>{children}</span>;
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th className={`px-3 py-2.5 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-[10px] whitespace-nowrap ${
      align === 'right' ? 'text-right' : 'text-left'
    }`}>
      {children}
    </th>
  );
}

function Kpi({ label, value, bar, accent }: { label: string; value: string; bar?: number; accent?: 'emerald' | 'blue' }) {
  const colorClass = accent === 'emerald' ? 'text-emerald-600 dark:text-emerald-400'
                   : accent === 'blue' ? 'text-blue-600 dark:text-blue-400'
                   : 'text-gray-900 dark:text-gray-100';
  const barColorClass = accent === 'emerald' ? 'bg-emerald-500'
                      : accent === 'blue' ? 'bg-blue-500'
                      : 'bg-gray-400';
  return (
    <div className="border border-gray-100 dark:border-gray-800 rounded-xl px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`text-lg sm:text-xl font-extrabold tabular-nums mt-0.5 ${colorClass}`}>{value}</p>
      {typeof bar === 'number' && (
        <div className="h-1 mt-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
          <div className={`h-full ${barColorClass}`} style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} />
        </div>
      )}
    </div>
  );
}
