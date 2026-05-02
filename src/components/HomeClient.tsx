'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Session } from 'next-auth';
import AppLayout from './AppLayout';
import { useLanguage } from './LanguageContext';

const today = () => new Date().toLocaleDateString('en-CA');

function greeting(lang: string): string {
  const h = new Date().getHours();
  if (lang === 'es') {
    if (h < 12) return 'Buenos días';
    if (h < 19) return 'Buenas tardes';
    return 'Buenas noches';
  }
  if (h < 12) return 'Good morning';
  if (h < 19) return 'Good afternoon';
  return 'Good evening';
}

interface ActivityEntry {
  id: string;
  agent_id: string;
  date: string;
  campaign_type: 'D2D' | 'Retail';
  knocks: number;
  contacts: number;
  bills: number;
  stops: number;
  zipcodes: number;
  credit_checks: number;
  sales: number;
}

interface User {
  id: string;
  name: string;
  username: string;
  role: string;
  is_active: boolean;
  manager_id: string | null;
}

interface NotifItem { id: string; status: string; }

export default function HomeClient({ session }: { session: Session }) {
  const { t, lang } = useLanguage();
  const role = session.user.role as string;
  const isAgent = role === 'agent';
  const isAdminOrCeo = role === 'admin' || role === 'ceo';

  const [loading, setLoading] = useState(true);
  const [myTodayEntry, setMyTodayEntry] = useState<ActivityEntry | null>(null);
  const [weekEntries, setWeekEntries] = useState<ActivityEntry[]>([]);
  const [agents, setAgents] = useState<User[]>([]);
  const [todayEntries, setTodayEntries] = useState<ActivityEntry[]>([]);
  const [pendingNotifs, setPendingNotifs] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const todayDate = today();

      if (isAgent) {
        const res = await fetch('/api/activity');
        if (res.ok) {
          const all: ActivityEntry[] = await res.json();
          setMyTodayEntry(all.find((e) => e.date === todayDate && e.agent_id === session.user.id) ?? null);
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - 7);
          setWeekEntries(all.filter((e) => new Date(e.date + 'T00:00:00') >= cutoff));
        }
      } else {
        const [actRes, usrRes] = await Promise.all([
          fetch('/api/activity'),
          fetch('/api/users'),
        ]);
        if (actRes.ok) {
          const all: ActivityEntry[] = await actRes.json();
          const td = all.filter((e) => e.date === todayDate);
          setTodayEntries(td);
          setMyTodayEntry(td.find((e) => e.agent_id === session.user.id) ?? null);
        }
        if (usrRes.ok) {
          const all: User[] = await usrRes.json();
          setAgents(all.filter((u) => u.role === 'agent' && u.is_active));
        }
        if (isAdminOrCeo) {
          const nRes = await fetch('/api/notifications');
          if (nRes.ok) {
            const data = await nRes.json();
            setPendingNotifs((data.notifications ?? []).filter((n: NotifItem) => n.status === 'pending').length);
          }
        }
      }
      setLoading(false);
    })();
  }, [session.user.id, isAgent, isAdminOrCeo]);

  const registeredIds = new Set(todayEntries.map((e) => e.agent_id));
  const registeredAgents = agents.filter((u) => registeredIds.has(u.id));
  const notRegisteredAgents = agents.filter((u) => !registeredIds.has(u.id));
  const weekSales = weekEntries.reduce((s, e) => s + e.sales, 0);
  const weekDays = new Set(weekEntries.map((e) => e.date)).size;

  const firstName = (session.user.name ?? '').split(' ')[0];

  // Greeting + today's date depend on the user's local clock, so we defer
  // both to after mount. Computing them during render produced different
  // strings on server (UTC) vs client (browser TZ) and triggered React's
  // hydration mismatch (#418) every load.
  const [greetingText, setGreetingText] = useState('');
  const [dateText, setDateText] = useState('');
  useEffect(() => {
    setGreetingText(greeting(lang));
    setDateText(new Date().toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    }));
  }, [lang]);

  return (
    <AppLayout session={session}>
      <div className="max-w-3xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-5">
        {/* Greeting */}
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
            {greetingText ? `${greetingText}, ${firstName}` : firstName}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 capitalize min-h-[1.25rem]">
            {dateText}
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-[var(--primary)] border-t-transparent animate-spin" />
          </div>
        ) : (
          <>
            {/* ── AGENT VIEW ── */}
            {isAgent && (
              <div className="space-y-4">
                {/* Today card */}
                <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 sm:p-5">
                  <h2 className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
                    {t('home.todayActivity')}
                  </h2>
                  {myTodayEntry ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center text-green-600 text-sm flex-shrink-0">✓</span>
                        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                          {myTodayEntry.campaign_type === 'D2D' ? '🚶 D2D' : '🏪 Retail'}
                          {' — '}
                          <span style={{ color: 'var(--primary)' }}>{myTodayEntry.sales} {t('common.sales')}</span>
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
                        {myTodayEntry.campaign_type === 'D2D' ? (
                          <>
                            <span>Knocks: <strong className="text-gray-800 dark:text-gray-200">{myTodayEntry.knocks}</strong></span>
                            <span>Contactos: <strong className="text-gray-800 dark:text-gray-200">{myTodayEntry.contacts}</strong></span>
                            <span>Bills: <strong className="text-gray-800 dark:text-gray-200">{myTodayEntry.bills}</strong></span>
                          </>
                        ) : (
                          <>
                            <span>Stops: <strong className="text-gray-800 dark:text-gray-200">{myTodayEntry.stops}</strong></span>
                            <span>Zipcodes: <strong className="text-gray-800 dark:text-gray-200">{myTodayEntry.zipcodes}</strong></span>
                            <span>Credit: <strong className="text-gray-800 dark:text-gray-200">{myTodayEntry.credit_checks}</strong></span>
                          </>
                        )}
                      </div>
                      <Link
                        href="/activity"
                        className="inline-block text-xs font-semibold px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors"
                      >
                        {t('home.editCTA')} →
                      </Link>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center text-amber-600 text-base flex-shrink-0">!</span>
                        <span className="text-sm text-gray-700 dark:text-gray-300">{t('home.noActivityYet')}</span>
                      </div>
                      <Link
                        href="/activity"
                        className="inline-flex items-center gap-1.5 text-sm font-semibold px-5 py-2.5 rounded-xl text-white transition-opacity hover:opacity-90 active:scale-95"
                        style={{ backgroundColor: 'var(--primary)' }}
                      >
                        📋 {t('home.registerCTA')}
                      </Link>
                    </div>
                  )}
                </div>

                {/* Week summary */}
                <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 sm:p-5">
                  <h2 className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
                    {t('home.thisWeek')}
                  </h2>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-gray-50 dark:bg-gray-800 px-4 py-3 text-center">
                      <p className="text-3xl font-extrabold text-gray-900 dark:text-gray-100">{weekDays}</p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">{t('home.daysWithActivity')}</p>
                    </div>
                    <div className="rounded-xl px-4 py-3 text-center" style={{ backgroundColor: 'var(--primary-light)' }}>
                      <p className="text-3xl font-extrabold" style={{ color: 'var(--primary)' }}>{weekSales}</p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">{t('home.totalSalesWeek')}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── MANAGER / ADMIN / CEO VIEW ── */}
            {!isAgent && (
              <div className="space-y-4">
                {/* Pending notifications banner (admin/CEO) */}
                {isAdminOrCeo && pendingNotifs > 0 && (
                  <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🔔</span>
                      <span className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                        {pendingNotifs} {t('home.pendingNotifs')}
                      </span>
                    </div>
                    <Link
                      href="/notifications"
                      className="text-xs font-bold px-3 py-1.5 rounded-xl bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 hover:opacity-90 transition-opacity whitespace-nowrap"
                    >
                      {t('home.viewNotifications')} →
                    </Link>
                  </div>
                )}

                {/* Team status */}
                <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
                  <div className="px-4 sm:px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                    <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">
                      {t('home.teamToday')}
                    </h2>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                      {registeredAgents.length}/{agents.length}
                    </span>
                  </div>

                  {/* Not registered */}
                  {notRegisteredAgents.length > 0 && (
                    <div className="px-4 sm:px-5 pt-3 pb-1">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-red-500 dark:text-red-400 mb-2">
                        ⚠ {t('home.notRegistered')} ({notRegisteredAgents.length})
                      </p>
                      <div className="space-y-1.5 mb-3">
                        {notRegisteredAgents.map((u) => (
                          <div key={u.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                            <span className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-[10px] font-bold text-red-600 dark:text-red-400 flex-shrink-0">
                              {u.name.charAt(0)}
                            </span>
                            <span className="font-medium">{u.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Registered */}
                  {registeredAgents.length > 0 && (
                    <div className={`px-4 sm:px-5 pb-3 ${notRegisteredAgents.length > 0 ? 'border-t border-gray-50 dark:border-gray-800 pt-3' : 'pt-3'}`}>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-green-600 dark:text-green-400 mb-2">
                        ✓ {t('home.registered')} ({registeredAgents.length})
                      </p>
                      <div className="space-y-1.5">
                        {registeredAgents.map((u) => {
                          const entry = todayEntries.find((e) => e.agent_id === u.id);
                          return (
                            <div key={u.id} className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 min-w-0">
                                <span className="w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-[10px] font-bold text-green-600 dark:text-green-400 flex-shrink-0">
                                  {u.name.charAt(0)}
                                </span>
                                <span className="font-medium truncate">{u.name}</span>
                              </div>
                              {entry && (
                                <div className="flex items-center gap-1.5 text-xs text-gray-400 flex-shrink-0">
                                  <span
                                    className="text-[10px] px-1.5 py-0.5 rounded font-bold text-white"
                                    style={{ backgroundColor: entry.campaign_type === 'D2D' ? '#0284c7' : '#9333ea' }}
                                  >
                                    {entry.campaign_type === 'D2D' ? 'D2D' : 'RTL'}
                                  </span>
                                  <span style={{ color: 'var(--primary)' }} className="font-semibold">
                                    {entry.sales} {t('common.sales')}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {agents.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-6">{t('home.loading')}</p>
                  )}
                </div>

                {/* Quick links */}
                <div className="grid grid-cols-2 gap-3">
                  <Link
                    href="/dashboard"
                    className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 hover:border-[var(--primary)] transition-colors group"
                  >
                    <p className="text-xl mb-1">📊</p>
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 group-hover:text-[var(--primary)] transition-colors">
                      Dashboard
                    </p>
                    <p className="text-[10px] text-gray-400">{t('dashboard.subtitle')}</p>
                  </Link>
                  <Link
                    href="/team"
                    className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 hover:border-[var(--primary)] transition-colors group"
                  >
                    <p className="text-xl mb-1">🏆</p>
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 group-hover:text-[var(--primary)] transition-colors">
                      {t('team.title')}
                    </p>
                    <p className="text-[10px] text-gray-400">{t('team.subtitle')}</p>
                  </Link>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
