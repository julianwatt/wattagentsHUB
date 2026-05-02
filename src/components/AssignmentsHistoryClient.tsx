'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useLanguage } from './LanguageContext';
import { fmtTime as fmtTimeI18n } from '@/lib/i18n';
import AssignmentTimelineModal from './AssignmentTimelineModal';
import { formatStoreLabel } from '@/lib/stores';

// ── Types ────────────────────────────────────────────────────────────────────
interface AgentLite { id: string; name: string; username: string; }
interface StoreLite { id: string; name: string; address: string | null; }

interface CancelledByUser { id: string; name: string; role: string }

interface HistoryRow {
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
  punctuality: 'on_time' | 'late' | 'late_arrival' | 'late_severe' | 'no_show' | null;
  status: string;
  rejection_reason: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancelled_by_user?: CancelledByUser | null;
  agent: AgentLite | null;
  store: StoreLite | null;
}

/** "Ended by Admin/CEO" badge label, derived from cancelled_by user role.
 *  Returns null when there's no cancelling user (e.g. row not cancelled or
 *  pre-shift cancellation that doesn't need a badge). */
function endedByLabel(
  row: { status: string; actual_entry_at: string | null; cancelled_by_user?: CancelledByUser | null },
  t: (k: string) => string,
): string | null {
  if (row.status !== 'cancelled' || !row.cancelled_by_user) return null;
  // Pre-shift cancellations (agent never arrived) don't need the badge.
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
  partial_rate: number;
  unmet_rate: number;
  punctuality_rate: number;
  avg_effective_minutes: number;
  avg_late_minutes: number;
  top_agents: { agent_id: string; name: string; total: number; met: number; met_rate: number }[];
  bottom_agents: { agent_id: string; name: string; total: number; met: number; met_rate: number }[];
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
const PUNCTUALITY_BUCKETS = ['on_time', 'late', 'no_show'] as const;
const STATUS_BUCKETS = ['completed', 'incomplete', 'rejected', 'cancelled'] as const;

type SortKey = 'shift_date' | 'effective_minutes' | 'created_at';
type SortDir = 'asc' | 'desc';

// ── Component ────────────────────────────────────────────────────────────────
export default function AssignmentsHistoryClient() {
  const { t, lang } = useLanguage();

  // Lookups for agent/store filters
  const [agents, setAgents] = useState<AgentLite[]>([]);
  const [stores, setStores] = useState<StoreLite[]>([]);

  // Filters
  const [from, setFrom] = useState(daysAgoLocal(30));
  const [to, setTo] = useState(todayLocal());
  const [agentFilter, setAgentFilter] = useState<Set<string>>(new Set());
  const [storeFilter, setStoreFilter] = useState<Set<string>>(new Set());
  const [durationFilter, setDurationFilter] = useState<Set<string>>(new Set());
  const [punctFilter, setPunctFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());

  // Sort + pagination
  const [sortKey, setSortKey] = useState<SortKey>('shift_date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Filter panel collapsed on mobile
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Data
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<SummaryShape | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Live tick for in-progress rows: per-minute re-render so the displayed
  // effective time rolls forward without a refetch. fetchedAt anchors the
  // delta added to server's effective_ms_now.
  const [fetchedAt, setFetchedAt] = useState<number>(() => Date.now());
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Detail modal state
  const [detailFor, setDetailFor] = useState<HistoryRow | null>(null);

  // ── Load lookups on mount ───────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [aRes, sRes] = await Promise.all([
          fetch('/api/users', { cache: 'no-store' }),
          fetch('/api/shift/stores', { cache: 'no-store' }),
        ]);
        if (aRes.ok) {
          const list: (AgentLite & { role: string; is_active: boolean })[] = await aRes.json();
          setAgents(
            list
              .filter((u) => u.role === 'agent' && u.is_active !== false)
              .map((u) => ({ id: u.id, name: u.name, username: u.username }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          );
        }
        if (sRes.ok) setStores(await sRes.json());
      } catch { /* silent */ }
    })();
  }, []);

  // ── Build query string ──────────────────────────────────────────────────
  const queryParams = useMemo(() => {
    const sp = new URLSearchParams();
    if (from) sp.set('from', from);
    if (to) sp.set('to', to);
    if (agentFilter.size > 0) sp.set('agents', Array.from(agentFilter).join(','));
    if (storeFilter.size > 0) sp.set('stores', Array.from(storeFilter).join(','));
    if (durationFilter.size > 0) sp.set('duration', Array.from(durationFilter).join(','));
    if (punctFilter.size > 0) sp.set('punctuality', Array.from(punctFilter).join(','));
    if (statusFilter.size > 0) sp.set('statuses', Array.from(statusFilter).join(','));
    return sp;
  }, [from, to, agentFilter, storeFilter, durationFilter, punctFilter, statusFilter]);

  // ── Fetch table page ────────────────────────────────────────────────────
  const fetchPage = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams(queryParams);
      sp.set('sort', sortKey);
      sp.set('dir', sortDir);
      sp.set('page', String(page));
      sp.set('pageSize', String(pageSize));
      const res = await fetch(`/api/assignments/history?${sp.toString()}`, { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        setRows(j.assignments ?? []);
        setTotal(j.total ?? 0);
        setFetchedAt(Date.now());
      }
    } catch { /* silent */ }
    setLoading(false);
  }, [queryParams, sortKey, sortDir, page]);

  // ── Fetch summary ───────────────────────────────────────────────────────
  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const res = await fetch(`/api/assignments/history/summary?${queryParams.toString()}`, { cache: 'no-store' });
      if (res.ok) setSummary(await res.json());
    } catch { /* silent */ }
    setSummaryLoading(false);
  }, [queryParams]);

  // Reset page when filters or sort change, then refetch.
  useEffect(() => { setPage(1); }, [queryParams, sortKey, sortDir]);
  useEffect(() => { fetchPage(); }, [fetchPage]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  // ── Filter helpers ──────────────────────────────────────────────────────
  const toggleSet = <T extends string>(setter: (fn: (prev: Set<T>) => Set<T>) => void, value: T) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });

  const resetFilters = () => {
    setFrom(daysAgoLocal(30));
    setTo(todayLocal());
    setAgentFilter(new Set());
    setStoreFilter(new Set());
    setDurationFilter(new Set());
    setPunctFilter(new Set());
    setStatusFilter(new Set());
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // ── Sort header click ───────────────────────────────────────────────────
  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };
  const sortIcon = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  // ── Formatting helpers ──────────────────────────────────────────────────
  const fmtDate = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
  const fmtTime = (iso: string | null) => fmtTimeI18n(iso, lang);

  // Cumplimiento label/colour for a row
  const durationCellClass = (r: HistoryRow): string => {
    if (r.met_duration === true) return 'bg-emerald-50 dark:bg-emerald-900/10';
    if (r.met_duration === false && r.effective_minutes > 0) return 'bg-amber-50 dark:bg-amber-900/10';
    if (r.met_duration === false && r.effective_minutes === 0) return 'bg-red-50 dark:bg-red-900/10';
    return '';
  };
  const durationBadge = (r: HistoryRow) => {
    if (r.met_duration === true) {
      return <Badge color="emerald">✓ {t('assignments.complianceMet')}</Badge>;
    }
    if (r.met_duration === false && r.effective_minutes > 0) {
      return <Badge color="amber">~ {t('assignments.compliancePartial')}</Badge>;
    }
    if (r.met_duration === false) {
      return <Badge color="red">✗ {t('assignments.complianceUnmet')}</Badge>;
    }
    return <span className="text-[10px] text-gray-400">—</span>;
  };
  const punctualityBadge = (p: HistoryRow['punctuality']) => {
    if (p === 'on_time')      return <Badge color="emerald">{t('assignments.punctualityOnTime')}</Badge>;
    if (p === 'late')         return <Badge color="amber">{t('assignments.punctualityLate')}</Badge>;
    if (p === 'late_arrival') return <Badge color="amber">{t('assignments.punctualityLateArrival')}</Badge>;
    if (p === 'late_severe')  return <Badge color="red">{t('assignments.punctualityLateSevere')}</Badge>;
    if (p === 'no_show')      return <Badge color="red">{t('assignments.punctualityNoShow')}</Badge>;
    return <span className="text-[10px] text-gray-400">—</span>;
  };
  const statusBadge = (s: string) => {
    const cls = s === 'completed' ? 'emerald'
              : s === 'incomplete' ? 'orange'
              : s === 'rejected' ? 'red'
              : s === 'cancelled' ? 'gray'
              : s === 'in_progress' ? 'sky'
              : s === 'accepted' ? 'sky'
              : 'amber';
    return <Badge color={cls as Color}>{t(`assignments.status${capitalize(s)}`)}</Badge>;
  };

  // Active filter count for the mobile summary
  const activeFilterCount =
    (agentFilter.size + storeFilter.size + durationFilter.size + punctFilter.size + statusFilter.size) +
    (from !== daysAgoLocal(30) || to !== todayLocal() ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* ── Filter panel ─────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        <button
          onClick={() => setFiltersOpen((o) => !o)}
          className="w-full sm:hidden px-4 py-3 flex items-center justify-between text-sm font-bold text-gray-700 dark:text-gray-200 border-b border-gray-100 dark:border-gray-800"
        >
          <span>{t('assignments.filters')}{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}</span>
          <span className="text-xs text-gray-400">{filtersOpen ? '▲' : '▼'}</span>
        </button>
        <div className={`${filtersOpen ? '' : 'hidden'} sm:block p-3 sm:p-4 space-y-3`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('assignments.filters')}</h3>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-400 tabular-nums">
                {summary ? summary.total : total} {t('notifications.records')}
                {summary?.capped && <span className="ml-1 text-amber-500">({t('assignments.summaryCapped')})</span>}
              </span>
              <button
                onClick={resetFilters}
                className="text-[11px] font-semibold hover:underline"
                style={{ color: 'var(--primary)' }}
              >
                {t('assignments.clearFilters')}
              </button>
            </div>
          </div>

          {/* Date range — both fields share a row on every breakpoint */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{t('assignments.filterFrom')}</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full max-w-full box-border px-2.5 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--primary)] appearance-none"
                style={{ minWidth: 0 }}
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{t('assignments.filterTo')}</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full max-w-full box-border px-2.5 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--primary)] appearance-none"
                style={{ minWidth: 0 }}
              />
            </div>
          </div>

          {/* Chip filters */}
          <FilterChipGroup
            label={t('assignments.filterDuration')}
            options={DURATION_BUCKETS.map((b) => ({
              value: b,
              label: b === 'met' ? t('assignments.complianceMet')
                   : b === 'partial' ? t('assignments.compliancePartial')
                   : t('assignments.complianceUnmet'),
            }))}
            selected={durationFilter}
            onToggle={(v) => toggleSet(setDurationFilter, v)}
          />
          <FilterChipGroup
            label={t('assignments.filterPunctuality')}
            options={PUNCTUALITY_BUCKETS.map((b) => ({
              value: b,
              label: b === 'on_time' ? t('assignments.punctualityOnTime')
                   : b === 'late' ? t('assignments.punctualityLate')
                   : t('assignments.punctualityNoShow'),
            }))}
            selected={punctFilter}
            onToggle={(v) => toggleSet(setPunctFilter, v)}
          />
          <FilterChipGroup
            label={t('assignments.filterStatus')}
            options={STATUS_BUCKETS.map((b) => ({
              value: b,
              label: t(`assignments.status${capitalize(b)}`),
            }))}
            selected={statusFilter}
            onToggle={(v) => toggleSet(setStatusFilter, v)}
          />

          {/* Multi-selects collapsed */}
          <details className="border-t border-gray-100 dark:border-gray-800 pt-2">
            <summary className="text-[11px] font-bold text-gray-500 dark:text-gray-400 cursor-pointer">
              {t('assignments.filterAgentsAndStores')}
            </summary>
            <div className="grid sm:grid-cols-2 gap-2 mt-2">
              <MultiSelectChips
                label={t('assignments.filterAgents')}
                options={agents.map((a) => ({ value: a.id, label: a.name }))}
                selected={agentFilter}
                onToggle={(v) => toggleSet(setAgentFilter, v)}
              />
              <MultiSelectChips
                label={t('assignments.filterStores')}
                options={stores.map((s) => ({ value: s.id, label: s.name }))}
                selected={storeFilter}
                onToggle={(v) => toggleSet(setStoreFilter, v)}
              />
            </div>
          </details>
        </div>
      </div>

      {/* ── Summary ──────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-3 sm:p-4">
        {summaryLoading || !summary ? (
          <p className="text-xs text-gray-400">{t('common.loading')}</p>
        ) : summary.total === 0 ? (
          <p className="text-xs text-gray-400">{t('assignments.summaryEmpty')}</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <KpiCard label={t('assignments.summaryTotalLabel')} value={summary.total.toString()} />
              <KpiCard label={t('assignments.summaryComplianceRate')} value={`${summary.met_rate}%`} bar={summary.met_rate} accent="emerald" />
              <KpiCard label={t('assignments.summaryPunctualityRate')} value={`${summary.punctuality_rate}%`} bar={summary.punctuality_rate} accent="blue" />
              <KpiCard label={t('assignments.summaryAvgEffective')} value={formatHHMM(summary.avg_effective_minutes)} />
              <KpiCard label={t('assignments.summaryAvgLate')} value={`${summary.avg_late_minutes} m`} accent={summary.avg_late_minutes > 10 ? 'amber' : undefined} />
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <AgentRanking title={`🏆 ${t('assignments.summaryTopAgents')}`} agents={summary.top_agents} t={t} />
              <AgentRanking title={`📉 ${t('assignments.summaryBottomAgents')}`} agents={summary.bottom_agents} t={t} reverse />
            </div>
          </div>
        )}
      </div>

      {/* ── Table ────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[900px]">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <Th onClick={() => onSort('shift_date')} icon={sortIcon('shift_date')}>{t('assignments.colDate')}</Th>
                <Th>{t('assignments.colAgent')}</Th>
                <Th>{t('assignments.colStore')}</Th>
                <Th>{t('assignments.colScheduled')}</Th>
                <Th>{t('assignments.colActualEntry')}</Th>
                <Th>{t('assignments.colActualExit')}</Th>
                <Th onClick={() => onSort('effective_minutes')} icon={sortIcon('effective_minutes')} align="right">{t('assignments.colEffective')}</Th>
                <Th>{t('assignments.colCompliance')}</Th>
                <Th>{t('assignments.colPunctuality')}</Th>
                <Th>{t('assignments.colStatus')}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-xs text-gray-400">{t('common.loading')}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-xs text-gray-400">{t('assignments.tableEmpty')}</td></tr>
              ) : rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setDetailFor(r)}
                  className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors ${durationCellClass(r)}`}
                >
                  <td className="px-3 py-2.5 tabular-nums text-gray-700 dark:text-gray-200 whitespace-nowrap">{fmtDate(r.shift_date)}</td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-gray-800 dark:text-gray-100">{r.agent?.name ?? '—'}</p>
                    <p className="text-[10px] text-gray-400">@{r.agent?.username ?? '—'}</p>
                  </td>
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
                  <td className="px-3 py-2.5">{durationBadge(r)}</td>
                  <td className="px-3 py-2.5">{punctualityBadge(r.punctuality)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col gap-1 items-start">
                      {statusBadge(r.status)}
                      {endedByLabel(r, t) && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 whitespace-nowrap">
                          ⏹ {endedByLabel(r, t)}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
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

      {/* Detail modal */}
      {detailFor && (
        <AssignmentTimelineModal
          assignmentId={detailFor.id}
          agentName={detailFor.agent?.name ?? '—'}
          storeName={detailFor.store ? formatStoreLabel(detailFor.store) : '—'}
          onClose={() => setDetailFor(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────
type Color = 'emerald' | 'red' | 'amber' | 'blue' | 'sky' | 'orange' | 'gray';

function Badge({ color, children }: { color: Color; children: React.ReactNode }) {
  const cls = {
    emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
    red:     'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    amber:   'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    blue:    'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    sky:     'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300',
    orange:  'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
    gray:    'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300',
  }[color];
  return <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap ${cls}`}>{children}</span>;
}

function Th({ children, onClick, icon, align }: { children: React.ReactNode; onClick?: () => void; icon?: string; align?: 'right' }) {
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2.5 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-[10px] whitespace-nowrap ${
        onClick ? 'cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 select-none' : ''
      } ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {children}{icon}
    </th>
  );
}

function FilterChipGroup({ label, options, selected, onToggle }: {
  label: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onToggle: (v: string) => void;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selected.has(opt.value);
          return (
            <button
              key={opt.value}
              onClick={() => onToggle(opt.value)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                active
                  ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary-light)]'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MultiSelectChips({ label, options, selected, onToggle }: {
  label: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onToggle: (v: string) => void;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        {options.length === 0 ? (
          <span className="text-[10px] text-gray-400 italic">—</span>
        ) : options.map((opt) => {
          const active = selected.has(opt.value);
          return (
            <button
              key={opt.value}
              onClick={() => onToggle(opt.value)}
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors ${
                active
                  ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary-light)]'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function KpiCard({ label, value, bar, accent }: { label: string; value: string; bar?: number; accent?: 'emerald' | 'amber' | 'blue' }) {
  const colorClass = accent === 'emerald' ? 'text-emerald-600 dark:text-emerald-400'
                   : accent === 'amber' ? 'text-amber-600 dark:text-amber-400'
                   : accent === 'blue' ? 'text-blue-600 dark:text-blue-400'
                   : 'text-gray-900 dark:text-gray-100';
  const barColorClass = accent === 'emerald' ? 'bg-emerald-500'
                      : accent === 'amber' ? 'bg-amber-500'
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

function AgentRanking({ title, agents, t, reverse }: {
  title: string;
  agents: { agent_id: string; name: string; total: number; met: number; met_rate: number }[];
  t: (k: string) => string;
  reverse?: boolean;
}) {
  return (
    <div className="border border-gray-100 dark:border-gray-800 rounded-xl px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">{title}</p>
      {agents.length === 0 ? (
        <p className="text-[10px] text-gray-400 italic">{t('assignments.summaryNoData')}</p>
      ) : (
        <ol className="space-y-0.5">
          {agents.map((a) => (
            <li key={a.agent_id} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate text-gray-800 dark:text-gray-200 font-medium">{a.name}</span>
              <span className={`font-bold tabular-nums ${
                reverse ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
              }`}>
                {a.met_rate}% <span className="text-gray-400 font-normal">· {a.met}/{a.total}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function capitalize(s: string): string {
  return s.replace(/^./, (c) => c.toUpperCase()).replace(/_(\w)/g, (_, c) => c.toUpperCase());
}
