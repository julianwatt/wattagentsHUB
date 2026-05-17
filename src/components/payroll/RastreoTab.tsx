'use client';
import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/components/LanguageContext';
import { saleStatusLabel } from '@/lib/payroll/labels';
import type { PayrollSale } from '@/types/payroll';
import type { SaleStatus, RosterCampaign } from '@/lib/payroll/constants';

/**
 * Block 08 — Rastreo de Ventas tab.
 *
 * Single focused view for now: Winback sales (the spec's
 * "vista separada con filtros por agente, fechas, campaign"). The wider
 * sales-tracking tab will land alongside block 10's reporting work.
 */

interface RastreoSale extends PayrollSale {
  agent_name: string | null;
  plan_mapping: { id: string; plan_name: string; plan_type: string; campaign: string | null } | null;
}

export default function RastreoTab() {
  const { t, lang } = useLanguage();
  const [sales, setSales] = useState<RastreoSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [campaign, setCampaign] = useState<RosterCampaign | ''>('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const url = new URL('/api/payroll/sales', window.location.origin);
    url.searchParams.set('winback_only', '1');
    if (from) url.searchParams.set('from', from);
    if (to) url.searchParams.set('to', to);
    if (campaign) url.searchParams.set('campaign', campaign);
    const r = await fetch(url.pathname + url.search);
    if (r.ok) {
      const j = await r.json();
      setSales(j.sales ?? []);
    }
    setLoading(false);
  }, [from, to, campaign]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-3 sm:p-4">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          {t('payroll.rastreo.winbackHint')}
        </p>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">
              {t('payroll.rastreo.from')}
            </label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">
              {t('payroll.rastreo.to')}
            </label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">
              {t('payroll.rastreo.campaign')}
            </label>
            <select value={campaign} onChange={(e) => setCampaign(e.target.value as RosterCampaign | '')}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100">
              <option value="">{lang === 'es' ? 'Todas' : 'All'}</option>
              <option value="D2D">D2D</option>
              <option value="RETAIL">Retail</option>
            </select>
          </div>
          <button onClick={refresh} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-xs">
            {t('common.refresh')}
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-3 sm:px-5 py-3 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">
            {t('payroll.rastreo.winbackTitle')}
          </h3>
          <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full px-2.5 py-0.5 font-semibold">
            {sales.length}
          </span>
        </div>
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('common.loading')}</div>
        ) : sales.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('payroll.rastreo.noWinbacks')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">{t('payroll.rastreo.colContract')}</th>
                  <th className="px-3 py-2 text-left">{t('payroll.rastreo.colCustomer')}</th>
                  <th className="px-3 py-2 text-left">{t('payroll.rastreo.colAgent')}</th>
                  <th className="px-3 py-2 text-left">{t('payroll.rastreo.colPlan')}</th>
                  <th className="px-3 py-2 text-center">{t('payroll.rastreo.colCampaign')}</th>
                  <th className="px-3 py-2 text-left">{t('payroll.rastreo.colSigned')}</th>
                  <th className="px-3 py-2 text-center">{t('payroll.rastreo.colStatus')}</th>
                  <th className="px-3 py-2 text-right">{t('payroll.rastreo.colAmount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {sales.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                    <td className="px-3 py-2 font-mono text-[11px] text-gray-700 dark:text-gray-200 whitespace-nowrap">
                      {s.contract_id}
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-200">{s.customer_name ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-200 whitespace-nowrap">
                      {s.agent_name ?? <span className="text-rose-500">— {s.je_badge}</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300 max-w-[250px] truncate" title={s.plan_name}>{s.plan_name}</td>
                    <td className="px-3 py-2 text-center text-gray-500 dark:text-gray-400">
                      {s.plan_mapping?.campaign ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 font-mono text-[10px]">{s.contract_signed_date ?? '—'}</td>
                    <td className="px-3 py-2 text-center">
                      <span className="inline-block bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 px-2 py-0.5 rounded-full text-[10px] font-bold">
                        {saleStatusLabel(s.status as SaleStatus, lang)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700 dark:text-gray-200 whitespace-nowrap">
                      ${Number(s.je_paid_amount).toFixed(2)}
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
