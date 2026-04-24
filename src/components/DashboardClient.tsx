'use client';
import { useState, useEffect, useMemo } from 'react';
import { Session } from 'next-auth';
import AppLayout from './AppLayout';
import { useLanguage } from './LanguageContext';
import { useTheme } from './ThemeContext';
import { usePreviewRole, useActiveUserId } from './PreviewRoleContext';
import { fmtDate } from '@/lib/i18n';
import type { Lang } from '@/lib/i18n';
import { ActivityEntryWithAgent, effectivenessRate } from '@/lib/activity';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

type Range = '7' | '30' | 'all';

function filterByRange(entries: ActivityEntryWithAgent[], range: Range): ActivityEntryWithAgent[] {
  if (range === 'all') return entries;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Number(range));
  const cutoffStr = cutoff.toISOString().split('T')[0];
  return entries.filter((e) => e.date >= cutoffStr);
}

function primaryField(e: ActivityEntryWithAgent) { return e.campaign_type === 'D2D' ? e.knocks : e.stops; }
function secondaryField(e: ActivityEntryWithAgent) { return e.campaign_type === 'D2D' ? e.contacts : e.zipcodes; }

function buildChartData(entries: ActivityEntryWithAgent[], lang: Lang = 'es') {
  // Group by date, summing across agents
  const byDate = new Map<string, { primary: number; secondary: number; sales: number; eff: number; count: number }>();
  entries.forEach((e) => {
    const prev = byDate.get(e.date) ?? { primary: 0, secondary: 0, sales: 0, eff: 0, count: 0 };
    byDate.set(e.date, {
      primary: prev.primary + primaryField(e),
      secondary: prev.secondary + secondaryField(e),
      sales: prev.sales + e.sales,
      eff: prev.eff + effectivenessRate(e),
      count: prev.count + 1,
    });
  });
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date: fmtDate(date, lang),
      fullDate: date,
      primary: v.primary,
      secondary: v.secondary,
      sales: v.sales,
      efectividad: v.count > 0 ? v.eff / v.count : 0,
    }));
}

function sumField(entries: ActivityEntryWithAgent[], fn: (e: ActivityEntryWithAgent) => number): number {
  return entries.reduce((s, e) => s + fn(e), 0);
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}


interface StatCardProps { label: string; value: string | number; sub?: string; color?: string; icon?: string; }
function StatCard({ label, value, sub, color = 'orange', icon }: StatCardProps) {
  // Darker gradients so the emoji icons stand out clearly
  const colors: Record<string, string> = {
    gold:   'from-fuchsia-600 to-purple-800',       // Best Day (celebration purple — distinct from yellow/orange)
    blue:   'from-sky-700 to-blue-900',             // Total interactions (knocks/stops)
    orange: 'from-cyan-600 to-cyan-800',            // Contacts / zipcodes (handshake cyan — communication)
    dark:   'from-slate-800 to-slate-950',          // Closed sales
    green:  'from-emerald-600 to-teal-800',         // Effectiveness (representative color)
  };
  return (
    <div className={`bg-gradient-to-br ${colors[color] ?? colors.orange} rounded-2xl p-4 text-white shadow-md`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-white/80 text-[10px] font-bold uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-extrabold mt-1 leading-tight truncate">{value}</p>
          {sub && <p className="text-white/70 text-[10px] mt-0.5 truncate">{sub}</p>}
        </div>
        {icon && <span className="text-2xl flex-shrink-0">{icon}</span>}
      </div>
    </div>
  );
}

export default function DashboardClient({ session }: { session: Session }) {
  const { t, lang } = useLanguage();
  const { theme } = useTheme();
  const { effectiveRole } = usePreviewRole();
  const { activeUserId, isPreviewMode } = useActiveUserId(session.user.id);
  const viewerRole = effectiveRole ?? session.user.role;
  const canSeeTeam = viewerRole !== 'agent';
  const isManager = viewerRole === 'jr_manager' || viewerRole === 'sr_manager' || viewerRole === 'ceo' || viewerRole === 'admin';
  const isDark = theme === 'dark';

  const [allEntries, setAllEntries] = useState<ActivityEntryWithAgent[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>('all');
  const [range, setRange] = useState<Range>('7');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      console.log('[Dashboard] fetching data', { activeUserId, isPreviewMode });
      const url = isPreviewMode ? `/api/activity?asUser=${activeUserId}` : '/api/activity';
      const res = await fetch(url);
      if (res.ok) {
        const data: ActivityEntryWithAgent[] = await res.json();
        setAllEntries(data);
        if (canSeeTeam) {
          const map = new Map<string, string>();
          data.forEach((e) => { if (e.agent_name) map.set(e.agent_id, e.agent_name); });
          setAgents(Array.from(map.entries()).map(([id, name]) => ({ id, name })));
        }
      }
      setLoading(false);
    })();
  }, [canSeeTeam, activeUserId, isPreviewMode]);

  const filtered = useMemo(() => {
    let entries = allEntries;
    if (canSeeTeam && selectedAgent !== 'all') entries = entries.filter((e) => e.agent_id === selectedAgent);
    return filterByRange(entries, range);
  }, [allEntries, selectedAgent, range, canSeeTeam]);

  const chartData = useMemo(() => buildChartData(filtered, lang), [filtered, lang]);

  // Per-day head count: how many distinct people worked D2D vs Retail each day
  const headcountByDay = useMemo(() => {
    const map = new Map<string, { d2d: Set<string>; retail: Set<string> }>();
    filtered.forEach((e) => {
      const slot = map.get(e.date) ?? { d2d: new Set<string>(), retail: new Set<string>() };
      if (e.campaign_type === 'D2D') slot.d2d.add(e.agent_id);
      else slot.retail.add(e.agent_id);
      map.set(e.date, slot);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, v]) => ({ date, d2d: v.d2d.size, retail: v.retail.size }));
  }, [filtered]);

  const totalPrimary = sumField(filtered, primaryField);
  const totalSecondary = sumField(filtered, secondaryField);
  const totalSales = sumField(filtered, (e) => e.sales);
  const avgEff = filtered.length > 0
    ? (filtered.reduce((s, e) => s + effectivenessRate(e), 0) / filtered.length).toFixed(1)
    : '0.0';

  const best = filtered.length > 0
    ? filtered.reduce((b, e) => e.sales > b.sales ? e : b, filtered[0])
    : null;

  const axisColor = isDark ? '#6b7280' : '#9ca3af';
  const gridColor = isDark ? '#1f2937' : '#f3f4f6';
  const tooltipBg = isDark ? '#1f2937' : '#ffffff';
  const tooltipBorder = isDark ? '#374151' : '#e5e7eb';

  // Last 7 days with timestamps (for agent view)
  const last7 = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    return allEntries
      .filter((e) => e.date >= cutoffStr && (selectedAgent === 'all' || e.agent_id === selectedAgent))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [allEntries, selectedAgent]);

  return (
    <AppLayout session={session}>
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-6">
        {/* Header + filters */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{t('dashboard.title')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('dashboard.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-1">
              {(['7', '30', 'all'] as Range[]).map((r) => (
                <button key={r} onClick={() => setRange(r)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${range === r ? 'bg-white dark:bg-gray-700 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}
                  style={range === r ? { color: 'var(--primary)' } : {}}>
                  {t(`dashboard.${r === '7' ? 'last7' : r === '30' ? 'last30' : 'allTime'}`)}
                </button>
              ))}
            </div>
            {canSeeTeam && agents.length > 0 && (
              <select value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)}
                className="px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--primary)]">
                <option value="all">{t('dashboard.allAgents')}</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-20 text-gray-400">{t('common.loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-4xl mb-3">📭</p>
            <p className="text-gray-600 dark:text-gray-300 font-medium">{t('dashboard.noData')}</p>
            <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">{t('dashboard.noDataSub')}</p>
          </div>
        ) : (
          <>
            {/* Stat cards — order: Best Day, Interactions, Contacts/Zipcodes, Sales, Effectiveness */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
              <StatCard
                label={t('dashboard.bestDayCard')}
                value={best && best.sales > 0 ? `${best.sales}` : '—'}
                sub={best && best.sales > 0 ? fmtDate(best.date, lang) : t('dashboard.noData')}
                icon="🏆"
                color="gold"
              />
              <StatCard label={t('dashboard.totalInteractions')} value={totalPrimary.toLocaleString()} icon="🚪" color="blue" />
              <StatCard label={t('dashboard.totalContacts')} value={totalSecondary.toLocaleString()} icon="🤝" color="orange" />
              <StatCard label={t('dashboard.totalSales')} value={totalSales.toLocaleString()} icon="✅" color="dark" />
              <StatCard label={t('dashboard.effectiveness')} value={`${avgEff}%`} icon="🎯" color="green" />
            </div>

            {/* Chart (dominant) + summary + headcount in same row */}
            {(() => {
              const showHeadcount = isManager && headcountByDay.length > 0;
              const gridCols = showHeadcount ? 'lg:grid-cols-5' : 'lg:grid-cols-4';
              return (
                <div className={`grid ${gridCols} gap-4`}>
                  {/* Chart — takes most space */}
                  <div className={`${showHeadcount ? 'lg:col-span-3' : 'lg:col-span-3'} bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 sm:p-5`}>
                    <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm mb-3">{t('dashboard.chartTitle')}</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: axisColor }} />
                        <YAxis yAxisId="left" tick={{ fontSize: 10, fill: axisColor }} />
                        <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 10, fill: axisColor }} domain={[0, 100]} />
                        <Tooltip contentStyle={{ backgroundColor: isDark ? 'rgba(31,41,55,0.7)' : 'rgba(255,255,255,0.7)', backdropFilter: 'blur(8px)', border: `1px solid ${tooltipBorder}`, borderRadius: 12, fontSize: 11, color: isDark ? '#f3f4f6' : '#1f2937' }} labelStyle={{ fontWeight: 700, color: isDark ? '#f3f4f6' : '#111827' }} formatter={(v: unknown, name: unknown) => { const n = String(name ?? ''); if (n === t('dashboard.chartEffectiveness')) { return [`${typeof v === 'number' ? v.toFixed(1) : v}%`, n] as [string, string]; } const val = typeof v === 'number' ? String(Math.round(v)) : String(v ?? ''); return [val, n] as [string, string]; }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar yAxisId="left" dataKey="primary" name={t('dashboard.chartInteractions')} fill="#0284c7" radius={[4, 4, 0, 0]} />
                        <Bar yAxisId="left" dataKey="secondary" name={t('dashboard.chartContacts')} fill="#f97316" radius={[4, 4, 0, 0]} />
                        <Bar yAxisId="left" dataKey="sales" name={t('dashboard.chartSales')} fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                        <Line yAxisId="right" type="monotone" dataKey="efectividad" name={t('dashboard.chartEffectiveness')} stroke="#10b981" strokeWidth={2.5} dot={{ r: 3, fill: '#10b981' }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Summary — thin */}
                  <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-50 dark:border-gray-800">
                      <h3 className="font-bold text-gray-800 dark:text-gray-100 text-xs">{t('dashboard.summaryTitle')}</h3>
                    </div>
                    <div className="divide-y divide-gray-50 dark:divide-gray-800 max-h-[280px] overflow-y-auto">
                      {last7.length === 0 ? (
                        <p className="text-xs text-gray-400 px-3 py-3">{t('common.noData')}</p>
                      ) : last7.map((e) => {
                        const isD2D = e.campaign_type === 'D2D';
                        return (
                          <div key={e.id} className="px-3 py-2">
                            <div className="flex items-center justify-between gap-1">
                              <div className="min-w-0 flex items-center gap-1">
                                <span className="text-[10px] px-1 py-0.5 rounded font-bold text-white flex-shrink-0" style={{ backgroundColor: isD2D ? '#0284c7' : '#9333ea' }}>
                                  {isD2D ? 'D2D' : 'RTL'}
                                </span>
                                <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200 truncate">{fmtDate(e.date, lang)}</span>
                              </div>
                              <span className="text-[11px] font-bold flex-shrink-0" style={{ color: 'var(--primary)' }}>{e.sales} {t('common.closings')}</span>
                            </div>
                            <div className="flex gap-2 text-[10px] text-gray-400 mt-0.5">
                              <span>🕐 {fmtTime(e.first_activity_at)}–{fmtTime(e.last_activity_at)}</span>
                              <span className="ml-auto">{effectivenessRate(e).toFixed(1)}%</span>
                            </div>
                            {canSeeTeam && e.agent_name && (
                              <p className="text-[10px] text-gray-400 truncate mt-0.5">{e.agent_name}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Headcount — thin, manager+ only */}
                  {showHeadcount && (
                    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
                      <div className="px-3 py-2 border-b border-gray-50 dark:border-gray-800">
                        <h3 className="font-bold text-gray-800 dark:text-gray-100 text-xs">{t('dashboard.headcountTitle')}</h3>
                      </div>
                      <div className="max-h-[280px] overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 dark:bg-gray-800/50 sticky top-0">
                            <tr className="text-left text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase">
                              <th className="px-3 py-1.5">{t('dashboard.headcountDate')}</th>
                              <th className="px-2 py-1.5">D2D</th>
                              <th className="px-2 py-1.5">RTL</th>
                              <th className="px-2 py-1.5 text-right">{t('dashboard.headcountTotal')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                            {headcountByDay.map((row) => (
                              <tr key={row.date}>
                                <td className="px-3 py-1.5 font-semibold text-gray-700 dark:text-gray-200">{fmtDate(row.date, lang)}</td>
                                <td className="px-2 py-1.5">
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300">{row.d2d}</span>
                                </td>
                                <td className="px-2 py-1.5">
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">{row.retail}</span>
                                </td>
                                <td className="px-2 py-1.5 text-right font-bold text-gray-800 dark:text-gray-100">{row.d2d + row.retail}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </>
        )}
      </div>
    </AppLayout>
  );
}
