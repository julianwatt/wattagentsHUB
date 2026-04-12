'use client';
import { useEffect, useMemo, useState } from 'react';
import { Session } from 'next-auth';
import AppLayout from './AppLayout';
import { useLanguage } from './LanguageContext';
import { ActivityEntryWithAgent, effectivenessRate } from '@/lib/activity';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';

interface Member {
  id: string;
  name: string;
  username: string;
  role: string;
  manager_id: string | null;
  hire_date: string;
}

interface TeamData {
  viewer: { id: string; name: string; role: string } | null;
  members: Member[];
  entries: ActivityEntryWithAgent[];
}

const today = () => new Date().toISOString().slice(0, 10);
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}
const MONTHS_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const dd = String(d.getDate()).padStart(2, '0');
  const mmm = MONTHS_SHORT[d.getMonth()];
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mmm}/${yy}`;
}
function daysSince(date: string): number {
  const ms = Date.now() - new Date(date).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}
function tenureLabel(days: number, t: (k: string) => string): string {
  if (days < 14) return `${days} ${t('team.days')}`;
  if (days < 60) return `${Math.floor(days / 7)} ${t('team.weeks')}`;
  const months = Math.floor(days / 30);
  return `${months} ${months === 1 ? 'mes' : 'meses'}`;
}

function roleLabel(role: string, t: (k: string) => string): string {
  switch (role) {
    case 'agent': return t('admin.roleAgent');
    case 'jr_manager': return t('admin.roleJrManager');
    case 'sr_manager': return t('admin.roleSrManager');
    case 'ceo': return t('admin.roleCeo');
    case 'admin': return t('admin.roleAdmin');
    default: return role;
  }
}

export default function TeamClient({ session }: { session: Session }) {
  const { t } = useLanguage();
  const [data, setData] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await fetch('/api/team');
      if (res.ok) setData(await res.json());
      setLoading(false);
    })();
  }, []);

  // ── Derived data ─────────────────────────────────────────────────────────
  const members = data?.members ?? [];
  const entries = data?.entries ?? [];

  const newest = useMemo(() => members.length === 0 ? null
    : members.reduce((a, b) => a.hire_date > b.hire_date ? a : b), [members]);
  const oldest = useMemo(() => members.length === 0 ? null
    : members.reduce((a, b) => a.hire_date < b.hire_date ? a : b), [members]);

  // Only consider entries belonging to roster members (exclude the viewer themselves)
  const memberEntries = useMemo(
    () => entries.filter((e) => members.some((m) => m.id === e.agent_id)),
    [entries, members],
  );

  // Per-agent aggregates
  const byAgent = useMemo(() => {
    const map = new Map<string, {
      sales: number; interactions: number; contacts: number;
      effSum: number; count: number;
    }>();
    memberEntries.forEach((e) => {
      const cur = map.get(e.agent_id) ?? { sales: 0, interactions: 0, contacts: 0, effSum: 0, count: 0 };
      const inter = e.campaign_type === 'D2D' ? e.knocks : e.stops;
      const cont = e.campaign_type === 'D2D' ? e.contacts : e.zipcodes;
      map.set(e.agent_id, {
        sales: cur.sales + e.sales,
        interactions: cur.interactions + inter,
        contacts: cur.contacts + cont,
        effSum: cur.effSum + effectivenessRate(e),
        count: cur.count + 1,
      });
    });
    return map;
  }, [memberEntries]);

  function findAgent(id: string): Member | undefined {
    return members.find((m) => m.id === id);
  }

  // Best/worst per metric (over all visible entries)
  const ranking = useMemo(() => {
    const list = Array.from(byAgent.entries())
      .map(([id, agg]) => ({
        id,
        agent: findAgent(id),
        sales: agg.sales,
        interactions: agg.interactions,
        contacts: agg.contacts,
        effectiveness: agg.count > 0 ? agg.effSum / agg.count : 0,
      }))
      .filter((r) => r.agent); // exclude viewer (not in members list)

    if (list.length === 0) return null;
    const pickMax = (k: 'sales' | 'interactions' | 'contacts' | 'effectiveness') =>
      list.reduce((a, b) => b[k] > a[k] ? b : a);
    const pickMin = (k: 'sales' | 'interactions' | 'contacts' | 'effectiveness') =>
      list.reduce((a, b) => b[k] < a[k] ? b : a);
    return {
      bestSales: pickMax('sales'),
      worstSales: pickMin('sales'),
      bestInteractions: pickMax('interactions'),
      bestContacts: pickMax('contacts'),
      bestEffectiveness: pickMax('effectiveness'),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byAgent, members]);

  // First/last sale of today
  const todaysSales = useMemo(() => {
    const todayStr = today();
    const todayEntries = memberEntries.filter((e) => e.date === todayStr && e.sales > 0);
    if (todayEntries.length === 0) return null;
    const withTime = todayEntries
      .map((e) => ({ entry: e, time: e.last_activity_at ?? e.first_activity_at ?? null }))
      .filter((x): x is { entry: ActivityEntryWithAgent; time: string } => !!x.time)
      .sort((a, b) => a.time.localeCompare(b.time));
    if (withTime.length === 0) return null;
    return { first: withTime[0], last: withTime[withTime.length - 1] };
  }, [memberEntries]);

  // Top rep: week / month / year (sales)
  const topRep = useMemo(() => {
    const now = new Date();
    const weekCut = new Date(now); weekCut.setDate(now.getDate() - 7);
    const monthCut = new Date(now); monthCut.setDate(now.getDate() - 30);
    const yearCut = new Date(now); yearCut.setDate(now.getDate() - 365);
    const wk = weekCut.toISOString().slice(0, 10);
    const mo = monthCut.toISOString().slice(0, 10);
    const yr = yearCut.toISOString().slice(0, 10);

    const sumSalesSince = (cutoff: string) => {
      const m = new Map<string, number>();
      memberEntries.forEach((e) => {
        if (e.date >= cutoff) m.set(e.agent_id, (m.get(e.agent_id) ?? 0) + e.sales);
      });
      let topId: string | null = null; let topVal = -1;
      m.forEach((v, k) => { if (v > topVal) { topVal = v; topId = k; } });
      if (!topId) return null;
      const a = findAgent(topId);
      if (!a) return null;
      return { agent: a, sales: topVal };
    };
    return { week: sumSalesSince(wk), month: sumSalesSince(mo), year: sumSalesSince(yr) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberEntries, members]);

  // Mini chart data per agent (last 14 days, sales)
  function miniSeries(agentId: string) {
    const cut = new Date(); cut.setDate(cut.getDate() - 14);
    const cutStr = cut.toISOString().slice(0, 10);
    return memberEntries
      .filter((e) => e.agent_id === agentId && e.date >= cutStr)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => ({ date: e.date.slice(5), sales: e.sales }));
  }

  return (
    <AppLayout session={session}>
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{t('team.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('team.subtitle')}</p>
        </div>

        {loading ? (
          <div className="text-center py-20 text-gray-400">Cargando...</div>
        ) : members.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-4xl mb-3">👥</p>
            <p className="text-gray-600 dark:text-gray-300 font-medium">{t('team.noTeam')}</p>
          </div>
        ) : (
          <>
            {/* ── Rankings + Top Rep — same row, horizontal ── */}
            <div className="flex flex-col lg:flex-row gap-5">
              {/* Rankings */}
              {ranking && (
                <div className="flex-1 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
                  <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm mb-4">{t('team.rankingsTitle')}</h3>
                  <div className="flex flex-wrap gap-3">
                    <RankCard
                      label={`${t('team.bestAgent')} · ${t('team.metricSales')}`}
                      sub={t('team.rankSubBestSales')}
                      name={ranking.bestSales.agent?.name ?? '—'}
                      value={ranking.bestSales.sales}
                      accent="emerald"
                      icon="🥇"
                    />
                    <RankCard
                      label={`${t('team.worstAgent')} · ${t('team.metricSales')}`}
                      sub={t('team.rankSubWorstSales')}
                      name={ranking.worstSales.agent?.name ?? '—'}
                      value={ranking.worstSales.sales}
                      accent="rose"
                      icon="📉"
                    />
                    <RankCard
                      label={`${t('team.bestAgent')} · ${t('team.metricInteractions')}`}
                      sub={t('team.rankSubBestInteractions')}
                      name={ranking.bestInteractions.agent?.name ?? '—'}
                      value={ranking.bestInteractions.interactions}
                      accent="sky"
                      icon="🚪"
                    />
                    <RankCard
                      label={`${t('team.bestAgent')} · ${t('team.metricEffectiveness')}`}
                      sub={t('team.rankSubBestEffectiveness')}
                      name={ranking.bestEffectiveness.agent?.name ?? '—'}
                      value={`${ranking.bestEffectiveness.effectiveness.toFixed(1)}%`}
                      accent="violet"
                      icon="🎯"
                    />
                  </div>

                  {todaysSales && (
                    <div className="mt-4 flex flex-wrap gap-3">
                      <div className="flex-1 min-w-[180px] rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">{t('team.firstSale')}</p>
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 mt-0.5">{todaysSales.first.entry.agent_name}</p>
                        <p className="text-xs text-gray-500">🕐 {fmtTime(todaysSales.first.time)}</p>
                      </div>
                      <div className="flex-1 min-w-[180px] rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-900/40 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">{t('team.lastSale')}</p>
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 mt-0.5">{todaysSales.last.entry.agent_name}</p>
                        <p className="text-xs text-gray-500">🕐 {fmtTime(todaysSales.last.time)}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Top Rep */}
              <div className="lg:w-72 flex-shrink-0 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
                <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm mb-4">🏆 {t('team.topRepTitle')}</h3>
                <div className="space-y-3">
                  <TopRepCard label={t('team.topWeek')} entry={topRep.week} />
                  <TopRepCard label={t('team.topMonth')} entry={topRep.month} />
                  <TopRepCard label={t('team.topYear')} entry={topRep.year} />
                </div>
              </div>
            </div>

            {/* ── Roster — compact, newest first ── */}
            <div className="max-w-3xl">
              <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
                <div className="px-3 py-2 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between">
                  <h3 className="font-bold text-gray-800 dark:text-gray-100 text-xs">{t('team.rosterTitle')}</h3>
                  <span className="text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full px-2 py-0.5 font-semibold">{members.length}</span>
                </div>
                <div className="divide-y divide-gray-50 dark:divide-gray-800">
                  {[...members].sort((a, b) => b.hire_date.localeCompare(a.hire_date)).map((m) => {
                    const days = daysSince(m.hire_date);
                    const isNewest = newest?.id === m.id;
                    const isOldest = oldest?.id === m.id;
                    return (
                      <div key={m.id} className="px-3 py-1.5 flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <div className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] flex-shrink-0"
                            style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
                            {m.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-800 dark:text-gray-100 text-[11px] truncate leading-tight">{m.name}</p>
                            <p className="text-[9px] text-gray-400 leading-tight">@{m.username} · {roleLabel(m.role, t)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0 text-right">
                          {isNewest && <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">★ {t('team.newest')}</span>}
                          {isOldest && !isNewest && <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">{t('team.oldest')}</span>}
                          <p className="text-[9px] text-gray-500">{fmtDate(m.hire_date)} · {tenureLabel(days, t)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ── Per-agent mini charts ── */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
              <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm mb-4">{t('team.miniChartsTitle')}</h3>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {members.map((m) => {
                  const series = miniSeries(m.id);
                  const agg = byAgent.get(m.id);
                  return (
                    <div key={m.id} className="rounded-xl border border-gray-100 dark:border-gray-800 p-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 truncate">{m.name}</p>
                        <p className="text-[10px] text-gray-400">{agg?.sales ?? 0} ventas</p>
                      </div>
                      <div className="h-16">
                        {series.length === 0 ? (
                          <p className="text-[10px] text-gray-400 text-center pt-5">Sin datos</p>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={series}>
                              <XAxis dataKey="date" hide />
                              <YAxis hide />
                              <Tooltip contentStyle={{ fontSize: 10, padding: 4, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(8px)', color: '#1f2937' }} formatter={(v: unknown, name: unknown) => { const val = typeof v === 'number' ? v.toFixed(1) : String(v ?? ''); return [val, String(name ?? '')] as [string, string]; }} />
                              <Line type="monotone" dataKey="sales" stroke="var(--primary)" strokeWidth={2} dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────────

function RankCard({ label, sub, name, value, accent, icon }: {
  label: string; sub?: string; name: string; value: string | number; accent: 'emerald' | 'rose' | 'sky' | 'violet'; icon: string;
}) {
  const colors: Record<string, string> = {
    emerald: 'from-emerald-500 to-teal-700',
    rose: 'from-rose-500 to-red-700',
    sky: 'from-sky-500 to-blue-700',
    violet: 'from-violet-500 to-purple-700',
  };
  return (
    <div className={`bg-gradient-to-br ${colors[accent]} rounded-xl p-3 text-white shadow-sm flex-1 min-w-[140px]`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-white/80">{label}</p>
          {sub && <p className="text-[9px] text-white/60 mt-0.5 leading-tight">{sub}</p>}
        </div>
        <span className="text-4xl">{icon}</span>
      </div>
      <p className="text-sm font-semibold mt-1 truncate">{name}</p>
      <p className="text-xl font-extrabold leading-tight">{value}</p>
    </div>
  );
}

function TopRepCard({ label, entry }: { label: string; entry: { agent: Member; sales: number } | null }) {
  return (
    <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-4">
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</p>
      {entry ? (
        <>
          <p className="text-base font-bold text-gray-800 dark:text-gray-100 mt-1 truncate">{entry.agent.name}</p>
          <p className="text-2xl font-extrabold mt-0.5" style={{ color: 'var(--primary)' }}>{entry.sales} <span className="text-xs font-medium text-gray-400">ventas</span></p>
        </>
      ) : (
        <p className="text-sm text-gray-400 mt-2">—</p>
      )}
    </div>
  );
}
