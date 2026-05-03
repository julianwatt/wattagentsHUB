'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Session } from 'next-auth';
import AppLayout from './AppLayout';
import { useLanguage } from './LanguageContext';
import { fmtDate, fmtDateTime, fmtTime } from '@/lib/i18n';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { fmtDistance } from '@/lib/geo';

// ── Shared types ──
interface DailySummary {
  id: string;
  date: string;
  d2d_knocks: number;
  d2d_contacts: number;
  d2d_bills: number;
  d2d_sales: number;
  d2d_agents: number;
  rtl_stops: number;
  rtl_zipcodes: number;
  rtl_credit_checks: number;
  rtl_sales: number;
  rtl_agents: number;
}

interface NotifData {
  actor_name?: string;
  alert_type?: string;
  store_name?: string;
  distance_meters?: number;
  event_type?: string;
  shift_log_id?: string;
}

interface NotifItem {
  id: string;
  type: string;
  user_name: string | null;
  user_username: string | null;
  data: NotifData | null;
  status: string;
  created_at: string;
}

type FilterType = 'all' | 'password' | 'users' | 'geofence';

// ── Shift logs types ──
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

// ── Agent status types ──
interface AgentStatus {
  userId: string;
  name: string;
  username: string;
  storeName: string;
  state: 'active' | 'break' | 'done';
  lastEventTime: string;
}

const SHIFT_EVENT_TYPES = ['clock_in', 'lunch_start', 'lunch_end', 'clock_out'] as const;
const SHIFT_EVENT_LABEL_KEYS: Record<string, string> = {
  clock_in: 'shift.clockIn',
  lunch_start: 'shift.lunchStart',
  lunch_end: 'shift.lunchEnd',
  clock_out: 'shift.clockOut',
};
const SHIFT_EVENT_ICONS: Record<string, string> = {
  clock_in: '\u{1F7E2}',
  lunch_start: '\u{1F37D}\uFE0F',
  lunch_end: '\u{1F504}',
  clock_out: '\u{1F534}',
};

const STATUS_CONFIG = {
  active: { dot: 'bg-green-500 animate-pulse', color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300', labelKey: 'shift.agentStatusActive' },
  break: { dot: 'bg-amber-500', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300', labelKey: 'shift.agentStatusBreak' },
  done: { dot: 'bg-gray-400', color: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400', labelKey: 'shift.agentStatusDone' },
};

type MainTab = 'notifications' | 'shifts' | 'status';

export default function NotificationsClient({ session }: { session: Session }) {
  const { t, lang } = useLanguage();
  const [mainTab, setMainTab] = useState<MainTab>('notifications');

  // ══════════════════════════════════════════════════════════
  // ── NOTIFICATIONS STATE ──
  // ══════════════════════════════════════════════════════════
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [notifications, setNotifications] = useState<NotifItem[]>([]);
  const [loadingSummaries, setLoadingSummaries] = useState(true);
  const [loadingNotifs, setLoadingNotifs] = useState(true);
  const [filterDate, setFilterDate] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [filterType, setFilterType] = useState<FilterType>('all');

  const fetchSummaries = useCallback(async () => {
    setLoadingSummaries(true);
    const url = filterDate
      ? `/api/daily-summaries?date=${filterDate}`
      : '/api/daily-summaries?days=30';
    const res = await fetch(url);
    if (res.ok) setSummaries(await res.json());
    setLoadingSummaries(false);
  }, [filterDate]);

  const fetchNotifications = useCallback(async () => {
    setLoadingNotifs(true);
    const res = await fetch('/api/notifications');
    if (res.ok) {
      const data = await res.json();
      setNotifications(data.notifications ?? []);
    }
    setLoadingNotifs(false);
  }, []);

  useEffect(() => { fetchSummaries(); }, [fetchSummaries]);
  useEffect(() => {
    fetchNotifications();
    const sb = getSupabaseBrowser();
    const channel = sb.channel('notifs-page').on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'admin_notifications' },
      () => { fetchNotifications(); },
    ).subscribe();
    return () => { sb.removeChannel(channel); };
  }, [fetchNotifications]);

  const handleDismiss = async (id: string) => {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, status: 'done' } : n));
  };

  const handleMarkAll = async () => {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markAll: true }),
    });
    setNotifications((prev) => prev.map((n) => ({ ...n, status: 'done' })));
  };

  const EVENT_LABELS: Record<string, string> = {
    clock_in: t('shift.clockIn'),
    lunch_start: t('shift.lunchStart'),
    lunch_end: t('shift.lunchEnd'),
    clock_out: t('shift.clockOut'),
  };

  const notifLabel = (type: string) => {
    if (type === 'password_reset') return t('notifications.passwordReset');
    if (type === 'password_change') return t('notifications.passwordChange');
    if (type === 'user_deactivated') return t('notifications.userDeactivated');
    if (type === 'user_activated') return t('notifications.userActivated');
    if (type === 'geofence_alert') return `\u26A0\uFE0F ${t('notifications.geofenceAlertLabel')}`;
    if (type === 'assignment_arrived') return `\u2705 ${t('notifications.assignmentArrivedLabel')}`;
    if (type === 'assignment_exited_warn') return `\u26A0\uFE0F ${t('notifications.assignmentExitedWarnLabel')}`;
    if (type === 'assignment_exited_final') return `\u{1F6D1} ${t('notifications.assignmentExitedFinalLabel')}`;
    if (type === 'assignment_reentered') return `\u{1F504} ${t('notifications.assignmentReenteredLabel')}`;
    if (type === 'assignment_accepted') return `\u2705 ${t('notifications.assignmentAcceptedLabel')}`;
    if (type === 'assignment_rejected') return `\u274C ${t('notifications.assignmentRejectedLabel')}`;
    return type;
  };

  const notifBadgeColor = (type: string) => {
    if (type === 'password_reset') return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
    if (type === 'password_change') return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300';
    if (type === 'user_deactivated') return 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300';
    if (type === 'user_activated') return 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300';
    if (type === 'geofence_alert') return 'bg-red-200 dark:bg-red-900/50 text-red-700 dark:text-red-200 ring-1 ring-red-300 dark:ring-red-700';
    // Assignment perimeter events \u2014 color matches the project's status spec
    // (verde=positivo, \u00E1mbar=temporal, rojo=problema, azul=recuperaci\u00F3n).
    if (type === 'assignment_arrived') return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300';
    if (type === 'assignment_exited_warn') return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
    if (type === 'assignment_exited_final') return 'bg-red-200 dark:bg-red-900/50 text-red-700 dark:text-red-200 ring-1 ring-red-300 dark:ring-red-700';
    if (type === 'assignment_reentered') return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300';
    // Agent accept/reject — emerald for positive ack, red for refusal.
    if (type === 'assignment_accepted') return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300';
    if (type === 'assignment_rejected') return 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300';
    return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300';
  };

  const notifDesc = (n: NotifItem) => {
    if (n.type === 'password_reset') return t('notifications.descReset');
    if (n.type === 'password_change') return `${t('notifications.descAdminChange')} ${n.user_name ?? '\u2014'}`;
    if (n.type === 'user_deactivated') {
      const actor = n.data?.actor_name;
      return actor ? t('notifications.descDeactivatedBy').replace('{actor}', actor) : t('notifications.descDeactivated');
    }
    if (n.type === 'user_activated') {
      const actor = n.data?.actor_name;
      return actor ? t('notifications.descActivatedBy').replace('{actor}', actor) : t('notifications.descActivated');
    }
    if (n.type === 'geofence_alert') {
      const d = n.data;
      const alertType = d?.alert_type === 'outside_perimeter' ? t('notifications.geofenceOutsidePerimeter') : t('notifications.geofenceLocationMismatch');
      const eventLabel = d?.event_type ? ` (${EVENT_LABELS[d.event_type] || d.event_type})` : '';
      const storeName = d?.store_name ? ` \u2014 ${d.store_name}` : '';
      const dist = d?.distance_meters ? ` a ${fmtDistance(d.distance_meters)}` : '';
      return `${alertType}${eventLabel}${storeName}${dist}`;
    }
    if (
      n.type === 'assignment_arrived' ||
      n.type === 'assignment_exited_warn' ||
      n.type === 'assignment_exited_final' ||
      n.type === 'assignment_reentered'
    ) {
      const d = n.data;
      const action =
        n.type === 'assignment_arrived'      ? t('notifications.assignmentArrivedDesc')
        : n.type === 'assignment_exited_warn'  ? t('notifications.assignmentExitedWarnDesc')
        : n.type === 'assignment_exited_final' ? t('notifications.assignmentExitedFinalDesc')
        :                                        t('notifications.assignmentReenteredDesc');
      const storeName = d?.store_name ? ` \u2014 ${d.store_name}` : '';
      // Distance only meaningful for the two exit events.
      const dist = (n.type === 'assignment_exited_warn' || n.type === 'assignment_exited_final') && d?.distance_meters
        ? ` (${fmtDistance(d.distance_meters)})`
        : '';
      return `${action}${storeName}${dist}`;
    }
    if (n.type === 'assignment_accepted' || n.type === 'assignment_rejected') {
      const d = n.data;
      const action = n.type === 'assignment_accepted'
        ? t('notifications.assignmentAcceptedDesc')
        : t('notifications.assignmentRejectedDesc');
      const storeName = d?.store_name ? ` \u2014 ${d.store_name}` : '';
      // Reject reason flows through the same `data` blob from the PATCH route.
      const dRej = d as (typeof d & { rejection_reason?: string });
      const reason = n.type === 'assignment_rejected' && dRej?.rejection_reason
        ? ` (\u201c${dRej.rejection_reason}\u201d)`
        : '';
      return `${action}${storeName}${reason}`;
    }
    return '';
  };

  const closingRate = (sales: number, denom: number) =>
    denom > 0 ? ((sales / denom) * 100).toFixed(1) + '%' : '0%';

  const visibleSummaries = showAll ? summaries : summaries.slice(0, 7);

  // Assignment perimeter events live under the same "Geofence" filter as
  // the legacy geofence_alert — same operational dimension (agente fuera
  // de su lugar) just emitted by a different code path.
  const isPerimeterEvent = (type: string) =>
    type === 'geofence_alert' ||
    type === 'assignment_arrived' ||
    type === 'assignment_exited_warn' ||
    type === 'assignment_exited_final' ||
    type === 'assignment_reentered';

  const filteredNotifs = notifications.filter((n) => {
    if (filterType === 'password') return n.type === 'password_reset' || n.type === 'password_change';
    if (filterType === 'users') return n.type === 'user_deactivated' || n.type === 'user_activated';
    if (filterType === 'geofence') return isPerimeterEvent(n.type);
    return true;
  });

  const groupedNotifs = filteredNotifs.reduce<Record<string, NotifItem[]>>((acc, n) => {
    const day = n.created_at.slice(0, 10);
    if (!acc[day]) acc[day] = [];
    acc[day].push(n);
    return acc;
  }, {});
  const sortedDays = Object.keys(groupedNotifs).sort((a, b) => b.localeCompare(a));

  const pendingCount = notifications.filter((n) => n.status === 'pending').length;

  const geofenceCount = notifications.filter((n) => isPerimeterEvent(n.type) && n.status === 'pending').length;

  const FILTERS: Array<{ key: FilterType; label: string; badge?: number }> = [
    { key: 'all', label: t('notifications.filterAll') },
    { key: 'geofence', label: `\u26A0\uFE0F ${t('notifications.geofenceFilterLabel')}`, badge: geofenceCount },
    { key: 'password', label: t('notifications.filterPassword') },
    { key: 'users', label: t('notifications.filterUsers') },
  ];

  // ══════════════════════════════════════════════════════════
  // ── SHIFT LOGS STATE ──
  // ══════════════════════════════════════════════════════════
  const [shiftLogs, setShiftLogs] = useState<ShiftLog[]>([]);
  const [shiftAgents, setShiftAgents] = useState<Agent[]>([]);
  const [shiftTotal, setShiftTotal] = useState(0);
  const [shiftPage, setShiftPage] = useState(1);
  const [shiftLoading, setShiftLoading] = useState(true);
  const shiftPageSize = 50;
  const [newLogIds, setNewLogIds] = useState<Set<string>>(new Set());

  const [shiftFilterAgent, setShiftFilterAgent] = useState('');
  const [shiftFilterEvent, setShiftFilterEvent] = useState('');
  const [shiftFilterDateFrom, setShiftFilterDateFrom] = useState('');
  const [shiftFilterDateTo, setShiftFilterDateTo] = useState('');

  // Fetch agents list (once)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/users', { cache: 'no-store' });
        if (res.ok) {
          const data: Agent[] = await res.json();
          setShiftAgents(data.filter((u) => ['agent', 'jr_manager', 'sr_manager'].includes(u.role)).sort((a, b) => a.name.localeCompare(b.name)));
        }
      } catch {}
    })();
  }, []);

  const fetchShiftLogs = useCallback(async () => {
    setShiftLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(shiftPage));
    if (shiftFilterAgent) params.set('agentId', shiftFilterAgent);
    if (shiftFilterEvent) params.set('eventType', shiftFilterEvent);
    if (shiftFilterDateFrom) params.set('dateFrom', shiftFilterDateFrom);
    if (shiftFilterDateTo) params.set('dateTo', shiftFilterDateTo);
    try {
      const res = await fetch(`/api/shift/logs?${params.toString()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setShiftLogs(data.logs ?? []);
        setShiftTotal(data.total ?? 0);
      }
    } catch {}
    setShiftLoading(false);
  }, [shiftPage, shiftFilterAgent, shiftFilterEvent, shiftFilterDateFrom, shiftFilterDateTo]);

  // Fetch shift logs when tab becomes active
  useEffect(() => {
    if (mainTab === 'shifts') fetchShiftLogs();
  }, [mainTab, fetchShiftLogs]);

  // Block 4: Realtime subscription for shift_logs
  useEffect(() => {
    const sb = getSupabaseBrowser();
    const channel = sb.channel('shift-logs-realtime').on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'shift_logs' },
      () => {
        // Re-fetch to get joined user/store data (payload only has raw columns)
        if (mainTab === 'shifts' && shiftPage === 1 && !shiftFilterAgent && !shiftFilterEvent && !shiftFilterDateFrom && !shiftFilterDateTo) {
          // Quick re-fetch for page 1 unfiltered view
          (async () => {
            try {
              const res = await fetch('/api/shift/logs?page=1', { cache: 'no-store' });
              if (res.ok) {
                const data = await res.json();
                const newLogs: ShiftLog[] = data.logs ?? [];
                // Find new IDs for highlight
                const oldIds = new Set(shiftLogs.map((l) => l.id));
                const fresh = new Set<string>();
                for (const l of newLogs) {
                  if (!oldIds.has(l.id)) fresh.add(l.id);
                }
                if (fresh.size > 0) {
                  setNewLogIds(fresh);
                  setTimeout(() => setNewLogIds(new Set()), 3000);
                }
                setShiftLogs(newLogs);
                setShiftTotal(data.total ?? 0);
              }
            } catch {}
          })();
        } else if (mainTab === 'shifts') {
          fetchShiftLogs();
        }
        // Also refresh agent status
        fetchAgentStatus();
      },
    ).subscribe();
    return () => { sb.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab, shiftPage, shiftFilterAgent, shiftFilterEvent, shiftFilterDateFrom, shiftFilterDateTo]);

  useEffect(() => { setShiftPage(1); }, [shiftFilterAgent, shiftFilterEvent, shiftFilterDateFrom, shiftFilterDateTo]);

  const shiftTotalPages = Math.max(1, Math.ceil(shiftTotal / shiftPageSize));

  // Use the centralized fmtDate/fmtTime helpers (which yield identical
  // output server-side and client-side, modulo a single timezone) instead
  // of toLocaleDateString — Node's runtime locale can disagree with the
  // browser's, which is one source of the React #418 hydration mismatch.
  const shiftFmtDate = (iso: string) => fmtDate(iso, lang);
  const shiftFmtTime = (iso: string) => fmtTime(iso, lang);

  const clearShiftFilters = () => {
    setShiftFilterAgent('');
    setShiftFilterEvent('');
    setShiftFilterDateFrom('');
    setShiftFilterDateTo('');
  };

  const hasShiftFilters = shiftFilterAgent || shiftFilterEvent || shiftFilterDateFrom || shiftFilterDateTo;

  // ══════════════════════════════════════════════════════════
  // ── AGENT STATUS STATE (Block 5) ──
  // ══════════════════════════════════════════════════════════
  const [agentStatuses, setAgentStatuses] = useState<AgentStatus[]>([]);
  const [statusLoading, setStatusLoading] = useState(true);
  const statusFetchedRef = useRef(false);

  const fetchAgentStatus = useCallback(async () => {
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const res = await fetch(`/api/shift/logs?dateFrom=${todayStr}&dateTo=${todayStr}&page=1&pageSize=500`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const logs: ShiftLog[] = data.logs ?? [];

      // Group by user_id and determine current state
      const byUser = new Map<string, ShiftLog[]>();
      for (const log of logs) {
        const uid = log.user_id;
        if (!byUser.has(uid)) byUser.set(uid, []);
        byUser.get(uid)!.push(log);
      }

      const statuses: AgentStatus[] = [];
      byUser.forEach((userLogs, userId) => {
        // Logs come sorted desc from API, so sort asc to determine state
        const sorted = [...userLogs].sort((a, b) => a.event_time.localeCompare(b.event_time));
        const last = sorted[sorted.length - 1];
        let state: 'active' | 'break' | 'done' = 'active';
        if (last.event_type === 'clock_out') state = 'done';
        else if (last.event_type === 'lunch_start') state = 'break';
        else state = 'active'; // clock_in or lunch_end

        statuses.push({
          userId,
          name: last.users?.name ?? '\u2014',
          username: last.users?.username ?? '\u2014',
          storeName: last.stores?.name ?? '\u2014',
          state,
          lastEventTime: last.event_time,
        });
      });

      // Sort: active first, then break, then done
      const order = { active: 0, break: 1, done: 2 };
      statuses.sort((a, b) => order[a.state] - order[b.state]);
      setAgentStatuses(statuses);
    } catch {}
    setStatusLoading(false);
  }, []);

  // Fetch agent statuses when tab is active
  useEffect(() => {
    if (mainTab === 'status') {
      setStatusLoading(true);
      fetchAgentStatus();
    }
  }, [mainTab, fetchAgentStatus]);

  // Dedicated Realtime subscription for agent status updates
  useEffect(() => {
    const sb = getSupabaseBrowser();
    const channel = sb.channel('agent-status-realtime').on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'shift_logs' },
      () => { fetchAgentStatus(); },
    ).subscribe();
    return () => { sb.removeChannel(channel); };
  }, [fetchAgentStatus]);

  // ══════════════════════════════════════════════════════════
  // ── RENDER ──
  // ══════════════════════════════════════════════════════════
  return (
    <AppLayout session={session}>
      {/* Highlight animation for new rows */}
      <style>{`
        @keyframes shiftHighlight {
          0% { background-color: rgba(var(--primary-rgb, 59, 130, 246), 0.2); }
          100% { background-color: transparent; }
        }
        .shift-new-row { animation: shiftHighlight 3s ease-out; }
      `}</style>

      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{t('notifications.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('notifications.subtitle')}</p>
        </div>

        {/* ── Main tab switcher ── */}
        <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700">
          {(['notifications', 'shifts', 'status'] as MainTab[]).map((tab) => {
            const labels: Record<MainTab, string> = {
              notifications: t('notifications.title'),
              shifts: t('admin.tabShifts'),
              status: t('shift.agentStatusTab'),
            };
            return (
              <button
                key={tab}
                onClick={() => setMainTab(tab)}
                className={`px-3 sm:px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                  mainTab === tab
                    ? 'border-[var(--primary)] text-[var(--primary)]'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {labels[tab]}
                {tab === 'notifications' && pendingCount > 0 && (
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold leading-none">
                    {pendingCount > 9 ? '9+' : pendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ════════════════════════════════════════════════════ */}
        {/* ── NOTIFICATIONS TAB ── */}
        {/* ════════════════════════════════════════════════════ */}
        {mainTab === 'notifications' && (
          <div className="grid lg:grid-cols-2 gap-5">
            {/* ── Card 1: Daily Summaries ── */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">{t('notifications.dailySummaries')}</h3>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={filterDate}
                    onChange={(e) => setFilterDate(e.target.value)}
                    className="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 text-[11px] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                    title={t('notifications.filterByDate')}
                  />
                  {filterDate && (
                    <button onClick={() => setFilterDate('')} className="text-[10px] text-gray-400 hover:text-gray-600 underline">
                      {t('common.close')}
                    </button>
                  )}
                </div>
              </div>

              <div className="max-h-[520px] overflow-y-auto divide-y divide-gray-50 dark:divide-gray-800">
                {loadingSummaries ? (
                  <p className="text-xs text-gray-400 px-4 py-6 text-center">{t('common.loading')}</p>
                ) : visibleSummaries.length === 0 ? (
                  <p className="text-xs text-gray-400 px-4 py-6 text-center">{t('notifications.noSummaries')}</p>
                ) : visibleSummaries.map((s) => (
                  <div key={s.id} className="px-4 py-3 space-y-2">
                    <p className="text-xs font-bold text-gray-700 dark:text-gray-200">{fmtDate(s.date, lang)}</p>
                    {(s.d2d_sales > 0 || s.d2d_knocks > 0) && (
                      <div className="bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-xl px-3 py-2">
                        <p className="text-[10px] font-bold text-sky-700 dark:text-sky-300 uppercase mb-1">{t('notifications.d2dTitle')}</p>
                        <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-[11px] text-gray-600 dark:text-gray-300">
                          <span>{t('notifications.knocks')}: <strong>{s.d2d_knocks}</strong></span>
                          <span>{t('notifications.contacts')}: <strong>{s.d2d_contacts}</strong></span>
                          <span>{t('notifications.bills')}: <strong>{s.d2d_bills}</strong></span>
                          <span>{t('notifications.sales')}: <strong>{s.d2d_sales}</strong></span>
                          <span>{t('notifications.closingRate')}: <strong>{closingRate(s.d2d_sales, s.d2d_contacts)}</strong></span>
                          <span>{t('notifications.agents')}: <strong>{s.d2d_agents}</strong></span>
                        </div>
                      </div>
                    )}
                    {(s.rtl_sales > 0 || s.rtl_stops > 0) && (
                      <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-xl px-3 py-2">
                        <p className="text-[10px] font-bold text-violet-700 dark:text-violet-300 uppercase mb-1">{t('notifications.rtlTitle')}</p>
                        <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-[11px] text-gray-600 dark:text-gray-300">
                          <span>{t('notifications.stops')}: <strong>{s.rtl_stops}</strong></span>
                          <span>{t('notifications.zipcodes')}: <strong>{s.rtl_zipcodes}</strong></span>
                          <span>{t('notifications.creditChecks')}: <strong>{s.rtl_credit_checks}</strong></span>
                          <span>{t('notifications.sales')}: <strong>{s.rtl_sales}</strong></span>
                          <span>{t('notifications.closingRate')}: <strong>{closingRate(s.rtl_sales, s.rtl_zipcodes)}</strong></span>
                          <span>{t('notifications.agents')}: <strong>{s.rtl_agents}</strong></span>
                        </div>
                      </div>
                    )}
                    {s.d2d_knocks === 0 && s.d2d_sales === 0 && s.rtl_stops === 0 && s.rtl_sales === 0 && (
                      <p className="text-[11px] text-gray-400 italic">{t('common.noData')}</p>
                    )}
                  </div>
                ))}
              </div>

              {!filterDate && summaries.length > 7 && (
                <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800">
                  <button
                    onClick={() => setShowAll(!showAll)}
                    className="text-[11px] font-semibold w-full text-center"
                    style={{ color: 'var(--primary)' }}
                  >
                    {showAll
                      ? t('notifications.showLess')
                      : t('notifications.viewAllDays').replace('{count}', String(summaries.length))}
                  </button>
                </div>
              )}
            </div>

            {/* ── Card 2: User Notifications ── */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2 flex-shrink-0">
                <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">{t('notifications.userNotifications')}</h3>
                <div className="flex items-center gap-2">
                  {pendingCount > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300">
                      {pendingCount}
                    </span>
                  )}
                  <button
                    onClick={handleMarkAll}
                    disabled={pendingCount === 0}
                    className="text-[10px] font-semibold px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-green-600 hover:border-green-300 dark:hover:text-green-400 dark:hover:border-green-700 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  >
                    {t('notifications.markAllRead')}
                  </button>
                </div>
              </div>

              <div className="px-4 py-2 border-b border-gray-50 dark:border-gray-800 flex gap-1.5 flex-shrink-0">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFilterType(f.key)}
                    className={`text-[10px] font-semibold px-2.5 py-1 rounded-full transition-colors flex items-center gap-1 ${
                      filterType === f.key
                        ? 'text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                    style={filterType === f.key ? { backgroundColor: 'var(--primary)' } : {}}
                  >
                    {f.label}
                    {f.badge && f.badge > 0 ? (
                      <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                        {f.badge > 9 ? '9+' : f.badge}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>

              <div className="flex-1 max-h-[480px] overflow-y-auto">
                {loadingNotifs ? (
                  <p className="text-xs text-gray-400 px-4 py-6 text-center">{t('common.loading')}</p>
                ) : filteredNotifs.length === 0 ? (
                  <p className="text-xs text-gray-400 px-4 py-6 text-center">{t('notifications.noNotifications')}</p>
                ) : sortedDays.map((day) => (
                  <div key={day}>
                    <div className="px-4 py-1.5 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-800 sticky top-0 z-10">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                        {fmtDate(day, lang)}
                      </span>
                    </div>
                    <div className="divide-y divide-gray-50 dark:divide-gray-800">
                      {groupedNotifs[day].map((n) => (
                        <div key={n.id} className={`px-4 py-3 ${n.type === 'geofence_alert' && n.status === 'pending' ? 'bg-red-50/60 dark:bg-red-900/15 border-l-4 border-l-red-500' : n.status === 'pending' ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${notifBadgeColor(n.type)}`}>
                                  {notifLabel(n.type)}
                                </span>
                                <span className="text-[10px] text-gray-400">{fmtDateTime(n.created_at, lang)}</span>
                              </div>
                              <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">{n.user_name ?? '\u2014'}</p>
                              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                {notifDesc(n)} {'\u00B7'} @{n.user_username}
                              </p>
                              <div className="flex items-center gap-2 mt-1.5">
                                {n.user_username && (
                                  <Link
                                    href="/manage/users"
                                    className="text-[10px] font-medium underline underline-offset-2"
                                    style={{ color: 'var(--primary)' }}
                                  >
                                    {t('notifications.viewUser')}
                                  </Link>
                                )}
                              </div>
                            </div>
                            <div className="flex-shrink-0 mt-1">
                              {n.status === 'done' ? (
                                <span className="text-[10px] px-2 py-1 rounded-lg font-bold text-green-600 dark:text-green-400">{t('notifications.done')}</span>
                              ) : (
                                <button
                                  onClick={() => handleDismiss(n.id)}
                                  className="text-[10px] px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-green-600 hover:border-green-300 transition-colors whitespace-nowrap"
                                >
                                  {t('notifications.markDone')}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════ */}
        {/* ── SHIFT LOGS TAB ── */}
        {/* ════════════════════════════════════════════════════ */}
        {mainTab === 'shifts' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <span>{'\u23F1\uFE0F'}</span>
                {t('shift.adminTitle')}
              </h2>
              <span className="text-xs text-gray-400">{shiftTotal} {t('notifications.records')}</span>
            </div>

            {/* Filters */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-3 sm:p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('shift.adminFilters')}</p>
                {hasShiftFilters && (
                  <button onClick={clearShiftFilters} className="text-[11px] font-semibold hover:underline" style={{ color: 'var(--primary)' }}>
                    {t('shift.adminClearFilters')}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <select value={shiftFilterAgent} onChange={(e) => setShiftFilterAgent(e.target.value)}
                  className="px-2.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--primary)]">
                  <option value="">{t('shift.adminAllAgents')}</option>
                  {shiftAgents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>

                <select value={shiftFilterEvent} onChange={(e) => setShiftFilterEvent(e.target.value)}
                  className="px-2.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--primary)]">
                  <option value="">{t('shift.adminAllEvents')}</option>
                  {SHIFT_EVENT_TYPES.map((et) => (
                    <option key={et} value={et}>{t(SHIFT_EVENT_LABEL_KEYS[et])}</option>
                  ))}
                </select>

                <input type="date" value={shiftFilterDateFrom} onChange={(e) => setShiftFilterDateFrom(e.target.value)}
                  placeholder={t('shift.adminDateFrom')}
                  className="px-2.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />

                <input type="date" value={shiftFilterDateTo} onChange={(e) => setShiftFilterDateTo(e.target.value)}
                  placeholder={t('shift.adminDateTo')}
                  className="px-2.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />
              </div>
            </div>

            {/* Table */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
              {shiftLoading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  {t('shift.loading')}
                </div>
              ) : shiftLogs.length === 0 ? (
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
                        {shiftLogs.map((log) => {
                          const outside = log.is_at_location === false;
                          const isNew = newLogIds.has(log.id);
                          return (
                            <tr key={log.id} className={`${outside ? 'bg-red-50/50 dark:bg-red-900/10 border-l-4 border-l-red-400' : ''} ${isNew ? 'shift-new-row' : ''}`}>
                              <td className="px-4 py-2.5">
                                <p className="font-medium text-gray-800 dark:text-gray-100">{log.users?.name ?? '\u2014'}</p>
                                <p className="text-[10px] text-gray-400">@{log.users?.username ?? '\u2014'}</p>
                              </td>
                              <td className="px-4 py-2.5">
                                <span className="inline-flex items-center gap-1">
                                  <span>{SHIFT_EVENT_ICONS[log.event_type] ?? '\u23FA'}</span>
                                  <span className="font-medium text-gray-700 dark:text-gray-200">{t(SHIFT_EVENT_LABEL_KEYS[log.event_type]) ?? log.event_type}</span>
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300 tabular-nums">{shiftFmtDate(log.event_time)}</td>
                              <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300 tabular-nums">{shiftFmtTime(log.event_time)}</td>
                              <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{log.stores?.name ?? '\u2014'}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums">
                                {log.distance_meters != null ? (
                                  <span className={outside ? 'font-bold text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}>{fmtDistance(log.distance_meters)}</span>
                                ) : (
                                  <span className="text-gray-300 dark:text-gray-600">{'\u2014'}</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                {log.is_at_location === true && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                                    {'\u2713'} {t('shift.adminInside')}
                                  </span>
                                )}
                                {log.is_at_location === false && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300">
                                    {'\u26A0'} {t('shift.adminOutside')}
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
                    {shiftLogs.map((log) => {
                      const outside = log.is_at_location === false;
                      const isNew = newLogIds.has(log.id);
                      return (
                        <div key={log.id} className={`px-4 py-3 ${outside ? 'bg-red-50/50 dark:bg-red-900/10 border-l-4 border-l-red-400' : ''} ${isNew ? 'shift-new-row' : ''}`}>
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{log.users?.name ?? '\u2014'}</p>
                              <p className="text-[10px] text-gray-400">@{log.users?.username ?? '\u2014'}</p>
                            </div>
                            {log.is_at_location === true && (
                              <span className="flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">{'\u2713'}</span>
                            )}
                            {log.is_at_location === false && (
                              <span className="flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300">{'\u26A0'} {fmtDistance(log.distance_meters ?? 0)}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[11px]">
                            <span>{SHIFT_EVENT_ICONS[log.event_type] ?? '\u23FA'}</span>
                            <span className="font-medium text-gray-700 dark:text-gray-200">{t(SHIFT_EVENT_LABEL_KEYS[log.event_type])}</span>
                            <span className="text-gray-400 ml-auto tabular-nums">{shiftFmtDate(log.event_time)} {shiftFmtTime(log.event_time)}</span>
                          </div>
                          {log.stores?.name && <p className="text-[10px] text-gray-400 mt-0.5">{'\u{1F4CD}'} {log.stores.name}</p>}
                        </div>
                      );
                    })}
                  </div>

                  {/* Pagination */}
                  {shiftTotalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800">
                      <button
                        onClick={() => setShiftPage((p) => Math.max(1, p - 1))}
                        disabled={shiftPage <= 1}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30 transition-colors"
                      >
                        {t('shift.adminPrev')}
                      </button>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {shiftPage} {t('shift.adminPageOf')} {shiftTotalPages}
                      </span>
                      <button
                        onClick={() => setShiftPage((p) => Math.min(shiftTotalPages, p + 1))}
                        disabled={shiftPage >= shiftTotalPages}
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
        )}

        {/* ════════════════════════════════════════════════════ */}
        {/* ── AGENT STATUS TAB (Block 5) ── */}
        {/* ════════════════════════════════════════════════════ */}
        {mainTab === 'status' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <span>{'\u{1F465}'}</span>
                {t('shift.agentStatusTitle')}
              </h2>
              <span className="text-xs text-gray-400">
                {agentStatuses.length} {t('notifications.agentsToday')}
              </span>
            </div>

            {statusLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-400">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                {t('common.loading')}
              </div>
            ) : agentStatuses.length === 0 ? (
              <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm py-16 text-center">
                <p className="text-3xl mb-2">{'\u{1F4CB}'}</p>
                <p className="text-sm text-gray-400">{t('shift.agentStatusNoAgents')}</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {agentStatuses.map((agent) => {
                  const cfg = STATUS_CONFIG[agent.state];
                  return (
                    <div key={agent.userId} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 flex items-center gap-3">
                      {/* Avatar */}
                      <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                        style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
                        {agent.name.charAt(0).toUpperCase()}
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{agent.name}</p>
                        <p className="text-[10px] text-gray-400 truncate">{'\u{1F4CD}'} {agent.storeName}</p>
                      </div>
                      {/* Status badge */}
                      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold flex-shrink-0 ${cfg.color}`}>
                        <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                        {t(cfg.labelKey)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
