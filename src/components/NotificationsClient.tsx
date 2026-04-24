'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Session } from 'next-auth';
import AppLayout from './AppLayout';
import { useLanguage } from './LanguageContext';
import { fmtDate, fmtDateTime } from '@/lib/i18n';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

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

export default function NotificationsClient({ session }: { session: Session }) {
  const { t, lang } = useLanguage();
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
    clock_in: 'Inicio de turno',
    lunch_start: 'Inicio de descanso',
    lunch_end: 'Regreso de descanso',
    clock_out: 'Fin de turno',
  };

  const notifLabel = (type: string) => {
    if (type === 'password_reset') return t('notifications.passwordReset');
    if (type === 'password_change') return t('notifications.passwordChange');
    if (type === 'user_deactivated') return t('notifications.userDeactivated');
    if (type === 'user_activated') return t('notifications.userActivated');
    if (type === 'geofence_alert') return '⚠️ Alerta Geofence';
    return type;
  };

  const notifBadgeColor = (type: string) => {
    if (type === 'password_reset') return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
    if (type === 'password_change') return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300';
    if (type === 'user_deactivated') return 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300';
    if (type === 'user_activated') return 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300';
    if (type === 'geofence_alert') return 'bg-red-200 dark:bg-red-900/50 text-red-700 dark:text-red-200 ring-1 ring-red-300 dark:ring-red-700';
    return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300';
  };

  const notifDesc = (n: NotifItem) => {
    if (n.type === 'password_reset') return t('notifications.descReset');
    if (n.type === 'password_change') return `${t('notifications.descAdminChange')} ${n.user_name ?? '—'}`;
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
      const alertType = d?.alert_type === 'outside_perimeter' ? 'Salió del perímetro durante turno' : 'Ubicación incorrecta al registrar evento';
      const eventLabel = d?.event_type ? ` (${EVENT_LABELS[d.event_type] || d.event_type})` : '';
      const store = d?.store_name ? ` — ${d.store_name}` : '';
      const dist = d?.distance_meters ? ` a ${d.distance_meters}m` : '';
      return `${alertType}${eventLabel}${store}${dist}`;
    }
    return '';
  };

  const closingRate = (sales: number, denom: number) =>
    denom > 0 ? ((sales / denom) * 100).toFixed(1) + '%' : '0%';

  // Show 7 days by default, all 30 if toggled
  const visibleSummaries = showAll ? summaries : summaries.slice(0, 7);

  // Filter notifications by type
  const filteredNotifs = notifications.filter((n) => {
    if (filterType === 'password') return n.type === 'password_reset' || n.type === 'password_change';
    if (filterType === 'users') return n.type === 'user_deactivated' || n.type === 'user_activated';
    if (filterType === 'geofence') return n.type === 'geofence_alert';
    return true;
  });

  // Group notifications by calendar day
  const groupedNotifs = filteredNotifs.reduce<Record<string, NotifItem[]>>((acc, n) => {
    const day = n.created_at.slice(0, 10);
    if (!acc[day]) acc[day] = [];
    acc[day].push(n);
    return acc;
  }, {});
  const sortedDays = Object.keys(groupedNotifs).sort((a, b) => b.localeCompare(a));

  const pendingCount = notifications.filter((n) => n.status === 'pending').length;

  const geofenceCount = notifications.filter((n) => n.type === 'geofence_alert' && n.status === 'pending').length;

  const FILTERS: Array<{ key: FilterType; label: string; badge?: number }> = [
    { key: 'all', label: t('notifications.filterAll') },
    { key: 'geofence', label: '⚠️ Geofence', badge: geofenceCount },
    { key: 'password', label: t('notifications.filterPassword') },
    { key: 'users', label: t('notifications.filterUsers') },
  ];

  return (
    <AppLayout session={session}>
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{t('notifications.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('notifications.subtitle')}</p>
        </div>

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

                  {/* D2D row */}
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

                  {/* RTL row */}
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
            {/* Header */}
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

            {/* Filter chips */}
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
                    <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center leading-none">
                      {f.badge > 9 ? '9+' : f.badge}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>

            {/* Notifications grouped by day */}
            <div className="flex-1 max-h-[480px] overflow-y-auto">
              {loadingNotifs ? (
                <p className="text-xs text-gray-400 px-4 py-6 text-center">{t('common.loading')}</p>
              ) : filteredNotifs.length === 0 ? (
                <p className="text-xs text-gray-400 px-4 py-6 text-center">{t('notifications.noNotifications')}</p>
              ) : sortedDays.map((day) => (
                <div key={day}>
                  {/* Day separator */}
                  <div className="px-4 py-1.5 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-800 sticky top-0 z-10">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                      {fmtDate(day, lang)}
                    </span>
                  </div>
                  {/* Notifs for this day */}
                  <div className="divide-y divide-gray-50 dark:divide-gray-800">
                    {groupedNotifs[day].map((n) => (
                      <div key={n.id} className={`px-4 py-3 ${n.type === 'geofence_alert' && n.status === 'pending' ? 'bg-red-50/60 dark:bg-red-900/15 border-l-4 border-l-red-500' : n.status === 'pending' ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${notifBadgeColor(n.type)}`}>
                                {notifLabel(n.type)}
                              </span>
                              <span className="text-[10px] text-gray-400">{fmtDateTime(n.created_at, lang)}</span>
                            </div>
                            <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">{n.user_name ?? '—'}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                              {notifDesc(n)} · @{n.user_username}
                            </p>
                            {/* Actions row */}
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
      </div>
    </AppLayout>
  );
}
