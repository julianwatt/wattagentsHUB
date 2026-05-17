'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/components/LanguageContext';
import { saleStatusLabel } from '@/lib/payroll/labels';
import type { PayrollSale } from '@/types/payroll';
import type { SaleStatus } from '@/lib/payroll/constants';

/**
 * Block 05 — Pay-week sales view.
 *
 * Lives as a sub-tab inside PendientesTab. Drives the green/amber/red
 * semáforo that gates publication of the weekly payfile (block 11 reads
 * the same validation result).
 */

interface ValidationIssue {
  code: 'VERIFY_PENDING' | 'NO_INTERNAL_AGENT' | 'NO_TIER' | 'NO_TERM' | 'NO_RATE' | 'OPEN_BADGE_ALERT';
  level: 'critical' | 'warning';
  count: number;
  sample_sale_ids: string[];
  detail: string;
}
interface ValidationResult {
  ok: boolean;
  pay_week: string;
  total_sales: number;
  issues: ValidationIssue[];
}

interface SaleRow extends PayrollSale {
  agent_name: string | null;
  plan_mapping: {
    id: string;
    plan_name: string;
    plan_type: string;
    campaign: string | null;
  } | null;
}

interface FetchResult {
  pay_week: string;
  validation: ValidationResult;
  sales: SaleRow[];
}

export default function SalesByWeekView() {
  const { t, lang } = useLanguage();
  const [weeks, setWeeks] = useState<string[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<string>('');
  const [data, setData] = useState<FetchResult | null>(null);
  const [loading, setLoading] = useState(true);

  // Load distinct pay_weeks once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/payroll/sales?weeks=1');
      if (!res.ok) {
        if (!cancelled) setLoading(false);
        return;
      }
      const ws: string[] = await res.json();
      if (cancelled) return;
      setWeeks(ws);
      if (ws.length > 0 && !selectedWeek) setSelectedWeek(ws[0]);
      else if (ws.length === 0) setLoading(false);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load detail when selectedWeek changes.
  const fetchDetail = useCallback(async (week: string) => {
    if (!week) return;
    setLoading(true);
    const res = await fetch(`/api/payroll/sales?pay_week=${encodeURIComponent(week)}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, []);
  useEffect(() => { if (selectedWeek) fetchDetail(selectedWeek); }, [selectedWeek, fetchDetail]);

  // ── Computed: counts by status ──────────────────────────────────────────────
  const counts = useMemo<Record<SaleStatus, number>>(() => {
    const acc: Record<SaleStatus, number> = {
      PAYABLE: 0, PAYABLE_NEXT_WEEK: 0, CHARGEBACK: 0,
      CANCELLED: 0, VERIFY: 0, WINBACK: 0,
    };
    if (!data) return acc;
    for (const s of data.sales) acc[s.status] = (acc[s.status] ?? 0) + 1;
    return acc;
  }, [data]);

  const noAgent = useMemo(() => {
    if (!data) return 0;
    return data.sales.filter((s) => !s.internal_agent_id).length;
  }, [data]);

  const winbackCount = useMemo(() => {
    if (!data) return 0;
    return data.sales.filter((s) => s.is_winback).length;
  }, [data]);

  if (weeks.length === 0 && !loading) {
    return (
      <div className="text-center py-16 text-gray-400 text-sm">
        {t('payroll.salesByWeek.empty')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header: week selector */}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">
            {t('payroll.salesByWeek.weekLabel')}
          </label>
          <select
            value={selectedWeek}
            onChange={(e) => setSelectedWeek(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          >
            {weeks.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <button
          onClick={() => selectedWeek && fetchDetail(selectedWeek)}
          className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-xs"
        >
          {t('common.refresh')}
        </button>
      </div>

      {/* Semáforo */}
      {data?.validation && <Semaforo validation={data.validation} t={t} />}

      {/* Status tiles */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <Tile label={saleStatusLabel('PAYABLE', lang)} count={counts.PAYABLE} accent="emerald" />
          <Tile label={saleStatusLabel('PAYABLE_NEXT_WEEK', lang)} count={counts.PAYABLE_NEXT_WEEK} accent="sky" />
          <Tile label={saleStatusLabel('CHARGEBACK', lang)} count={counts.CHARGEBACK} accent="rose" />
          <Tile label={saleStatusLabel('VERIFY', lang)} count={counts.VERIFY} accent="amber" />
          <Tile label={saleStatusLabel('WINBACK', lang)} count={winbackCount} accent="violet" />
          <Tile label={t('payroll.salesByWeek.noAgent')} count={noAgent} accent={noAgent > 0 ? 'rose' : 'gray'} />
        </div>
      )}

      {/* Sales table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-3 sm:px-5 py-3 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">
            {t('payroll.salesByWeek.listTitle')}
          </h3>
          <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full px-2.5 py-0.5 font-semibold">
            {data?.sales.length ?? 0}
          </span>
        </div>
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('common.loading')}</div>
        ) : !data || data.sales.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('common.noData')}</div>
        ) : (
          <div className="overflow-x-auto max-h-[60vh]">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">{t('payroll.salesByWeek.colContract')}</th>
                  <th className="px-3 py-2 text-left">{t('payroll.salesByWeek.colAgent')}</th>
                  <th className="px-3 py-2 text-left">{t('payroll.salesByWeek.colPlan')}</th>
                  <th className="px-3 py-2 text-center">{t('payroll.salesByWeek.colStatus')}</th>
                  <th className="px-3 py-2 text-center">{t('payroll.salesByWeek.colTier')}</th>
                  <th className="px-3 py-2 text-center">{t('payroll.salesByWeek.colTerm')}</th>
                  <th className="px-3 py-2 text-right">{t('payroll.salesByWeek.colAmount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {data.sales.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                    <td className="px-3 py-2 font-mono text-[11px] text-gray-700 dark:text-gray-200 whitespace-nowrap">
                      {s.contract_id}
                      {s.is_winback && (
                        <span className="ml-1 inline-block bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 rounded text-[9px] font-bold">
                          W
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-200 whitespace-nowrap">
                      {s.agent_name ?? <span className="text-rose-500">— {s.je_badge}</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300 max-w-[280px] truncate" title={s.plan_name}>
                      {s.plan_name}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <StatusBadge status={s.status} lang={lang} />
                    </td>
                    <td className="px-3 py-2 text-center text-gray-600 dark:text-gray-300">
                      {s.assigned_tier !== null ? `T${s.assigned_tier}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-center text-gray-600 dark:text-gray-300">
                      {s.assigned_term_months ? `${s.assigned_term_months}M` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700 dark:text-gray-200 whitespace-nowrap">
                      {s.status === 'CHARGEBACK' ? '-' : ''}${s.je_paid_amount.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Semaforo({
  validation, t,
}: {
  validation: ValidationResult;
  t: (k: string) => string;
}) {
  const critical = validation.issues.filter((i) => i.level === 'critical');
  const warnings = validation.issues.filter((i) => i.level === 'warning');

  const color =
    critical.length > 0 ? 'rose' :
    warnings.length > 0 ? 'amber' :
    'emerald';
  const heading =
    critical.length > 0 ? t('payroll.salesByWeek.statusRed') :
    warnings.length > 0 ? t('payroll.salesByWeek.statusAmber') :
    t('payroll.salesByWeek.statusGreen');

  const colorClass: Record<string, string> = {
    rose:    'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 text-rose-800 dark:text-rose-200',
    amber:   'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200',
    emerald: 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200',
  };

  return (
    <div className={`rounded-2xl border p-3 sm:p-4 ${colorClass[color]}`}>
      <p className="text-sm font-bold">{heading}</p>
      {validation.issues.length === 0 ? (
        <p className="text-xs mt-1 opacity-90">{t('payroll.salesByWeek.statusGreenHint')}</p>
      ) : (
        <ul className="text-xs mt-2 space-y-1 opacity-95">
          {validation.issues.map((i) => (
            <li key={i.code}>
              <span className="font-bold">[{i.count}]</span> {i.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Tile({ label, count, accent }: { label: string; count: number; accent: string }) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    sky:     'bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800',
    rose:    'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800',
    amber:   'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    gray:    'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700',
    violet:  'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800',
  };
  return (
    <div className={`rounded-xl border px-3 py-2 ${colors[accent] ?? colors.gray}`}>
      <p className="text-xl font-extrabold leading-tight">{count}</p>
      <p className="text-[10px] uppercase tracking-wide opacity-80 mt-0.5">{label}</p>
    </div>
  );
}

function StatusBadge({ status, lang }: { status: SaleStatus; lang: 'es' | 'en' }) {
  const color =
    status === 'PAYABLE'           ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
    status === 'PAYABLE_NEXT_WEEK' ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300' :
    status === 'CHARGEBACK'        ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300' :
    status === 'VERIFY'            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
    status === 'WINBACK'           ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300' :
                                     'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>
      {saleStatusLabel(status, lang)}
    </span>
  );
}
