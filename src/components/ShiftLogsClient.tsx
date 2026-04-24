'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Session } from 'next-auth';
import AppLayout from './AppLayout';
import { useLanguage } from './LanguageContext';

interface ShiftLog {
  id: string;
  user_id: string;
  store_id: string;
  event_type: string;
  event_time: string;
  latitude: number | null;
  longitude: number | null;
  is_at_location: boolean | null;
  distance_meters: number | null;
  users: { id: string; name: string; username: string };
  stores: { id: string; name: string } | null;
}

interface Agent {
  id: string;
  name: string;
  username: string;
  role: string;
}

const EVENT_TYPES = ['clock_in', 'lunch_start', 'lunch_end', 'clock_out'] as const;

const EVENT_LABEL_KEYS: Record<string, string> = {
  clock_in: 'shift.clockIn',
  lunch_start: 'shift.lunchStart',
  lunch_end: 'shift.lunchEnd',
  clock_out: 'shift.clockOut',
};

const EVENT_ICONS: Record<string, string> = {
  clock_in: '🟢',
  lunch_start: '🍽️',
  lunch_end: '🔄',
  clock_out: '🔴',
};

export default function ShiftLogsClient({ session }: { session: Session }) {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const isCeoViewer = session.user.role === 'ceo';
  const [logs, setLogs] = useState<ShiftLog[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 50;

  // Filters
  const [filterAgent, setFilterAgent] = useState('');
  const [filterEvent, setFilterEvent] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // Fetch agents list
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/users', { cache: 'no-store' });
        if (res.ok) {
          const data: Agent[] = await res.json();
          setAgents(data.filter((u) => ['agent', 'jr_manager', 'sr_manager'].includes(u.role)).sort((a, b) => a.name.localeCompare(b.name)));
        }
      } catch {}
    })();
  }, []);

  // Fetch shift logs
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    if (filterAgent) params.set('agentId', filterAgent);
    if (filterEvent) params.set('eventType', filterEvent);
    if (filterDateFrom) params.set('dateFrom', filterDateFrom);
    if (filterDateTo) params.set('dateTo', filterDateTo);

    try {
      const res = await fetch(`/api/shift/logs?${params.toString()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs ?? []);
        setTotal(data.total ?? 0);
      }
    } catch {}
    setLoading(false);
  }, [page, filterAgent, filterEvent, filterDateFrom, filterDateTo]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [filterAgent, filterEvent, filterDateFrom, filterDateTo]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(lang === 'en' ? 'en-US' : 'es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const clearFilters = () => {
    setFilterAgent('');
    setFilterEvent('');
    setFilterDateFrom('');
    setFilterDateTo('');
  };

  const hasFilters = filterAgent || filterEvent || filterDateFrom || filterDateTo;

  return (
    <AppLayout session={session}>
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4">
        {/* Page header */}
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{t('admin.title')}</h1>
        </div>

        {/* Tab switcher — shared with UsersManagementClient */}
        <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => router.push('/manage/users')}
            className="px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            {t('admin.tabUsers')}
          </button>
          {!isCeoViewer && (
            <button
              onClick={() => router.push('/manage/users')}
              className="px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              {t('admin.tabRoster')}
            </button>
          )}
          <button
            className="px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap border-[var(--primary)] text-[var(--primary)]"
          >
            {t('admin.tabShifts')}
          </button>
        </div>

        {/* Section header */}
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <span>⏱️</span>
            {t('shift.adminTitle')}
          </h2>
          <span className="text-xs text-gray-400">{total} registros</span>
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-3 sm:p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('shift.adminFilters')}</p>
            {hasFilters && (
              <button onClick={clearFilters} className="text-[11px] font-semibold hover:underline" style={{ color: 'var(--primary)' }}>
                {t('shift.adminClearFilters')}
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {/* Agent filter */}
            <select value={filterAgent} onChange={(e) => setFilterAgent(e.target.value)}
              className="px-2.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--primary)]">
              <option value="">{t('shift.adminAllAgents')}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>

            {/* Event type filter */}
            <select value={filterEvent} onChange={(e) => setFilterEvent(e.target.value)}
              className="px-2.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--primary)]">
              <option value="">{t('shift.adminAllEvents')}</option>
              {EVENT_TYPES.map((et) => (
                <option key={et} value={et}>{t(EVENT_LABEL_KEYS[et])}</option>
              ))}
            </select>

            {/* Date from */}
            <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)}
              placeholder={t('shift.adminDateFrom')}
              className="px-2.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />

            {/* Date to */}
            <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)}
              placeholder={t('shift.adminDateTo')}
              className="px-2.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />
          </div>
        </div>

        {/* Table */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              {t('shift.loading')}
            </div>
          ) : logs.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">{t('shift.adminNoResults')}</div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('shift.adminAgent')}</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('shift.adminEventType')}</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('shift.adminDate')}</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('shift.adminTime')}</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('shift.adminStore')}</th>
                      <th className="text-right px-4 py-2.5 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('shift.adminDistance')}</th>
                      <th className="text-center px-4 py-2.5 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('shift.adminStatus')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                    {logs.map((log) => {
                      const outside = log.is_at_location === false;
                      return (
                        <tr key={log.id} className={outside ? 'bg-red-50/50 dark:bg-red-900/10 border-l-4 border-l-red-400' : ''}>
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-gray-800 dark:text-gray-100">{log.users?.name ?? '—'}</p>
                            <p className="text-[10px] text-gray-400">@{log.users?.username ?? '—'}</p>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="inline-flex items-center gap-1">
                              <span>{EVENT_ICONS[log.event_type] ?? '⏺'}</span>
                              <span className="font-medium text-gray-700 dark:text-gray-200">{t(EVENT_LABEL_KEYS[log.event_type]) ?? log.event_type}</span>
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300 tabular-nums">{fmtDate(log.event_time)}</td>
                          <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300 tabular-nums">{fmtTime(log.event_time)}</td>
                          <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{log.stores?.name ?? '—'}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {log.distance_meters != null ? (
                              <span className={outside ? 'font-bold text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}>{Math.round(log.distance_meters)}m</span>
                            ) : (
                              <span className="text-gray-300 dark:text-gray-600">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            {log.is_at_location === true && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                                ✓ {t('shift.adminInside')}
                              </span>
                            )}
                            {log.is_at_location === false && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300">
                                ⚠ {t('shift.adminOutside')}
                              </span>
                            )}
                            {log.is_at_location == null && (
                              <span className="text-[10px] text-gray-400">{t('shift.adminNoGps')}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="sm:hidden divide-y divide-gray-50 dark:divide-gray-800">
                {logs.map((log) => {
                  const outside = log.is_at_location === false;
                  return (
                    <div key={log.id} className={`px-4 py-3 ${outside ? 'bg-red-50/50 dark:bg-red-900/10 border-l-4 border-l-red-400' : ''}`}>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{log.users?.name ?? '—'}</p>
                          <p className="text-[10px] text-gray-400">@{log.users?.username ?? '—'}</p>
                        </div>
                        {log.is_at_location === true && (
                          <span className="flex-shrink-0 px-2 py-0.5 rounded-full text-[9px] font-bold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">✓</span>
                        )}
                        {log.is_at_location === false && (
                          <span className="flex-shrink-0 px-2 py-0.5 rounded-full text-[9px] font-bold bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300">⚠ {Math.round(log.distance_meters ?? 0)}m</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span>{EVENT_ICONS[log.event_type] ?? '⏺'}</span>
                        <span className="font-medium text-gray-700 dark:text-gray-200">{t(EVENT_LABEL_KEYS[log.event_type])}</span>
                        <span className="text-gray-400 ml-auto tabular-nums">{fmtDate(log.event_time)} {fmtTime(log.event_time)}</span>
                      </div>
                      {log.stores?.name && <p className="text-[10px] text-gray-400 mt-0.5">📍 {log.stores.name}</p>}
                    </div>
                  );
                })}
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
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {page} {t('shift.adminPageOf')} {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30 transition-colors"
                  >
                    {t('shift.adminNext')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
