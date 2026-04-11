'use client';
import { BillResult } from '@/lib/rates';
import { useLanguage } from './LanguageContext';

interface Props { result: BillResult; onReset: () => void; agentName: string; }

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

export default function BillBreakdown({ result, onReset, agentName }: Props) {
  const { t, lang } = useLanguage();
  const { kwh, tdu, plan, lineItems, subtotal, taxes, billCredit, total, avgTxBill, savings, savingsPercent, effectiveRate, avgTxRate } = result;

  const charges = lineItems.filter((l) => l.type === 'charge');
  const taxItems = lineItems.filter((l) => l.type === 'tax');
  const credits = lineItems.filter((l) => l.type === 'credit');
  const isPositive = savings > 0;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{t('bill.title')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('bill.simulationFor')} <span className="font-semibold text-gray-700 dark:text-gray-200">{result.customerName}</span> · {t('bill.presentedBy')} {agentName}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 print:hidden">
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
            {t('bill.print')}
          </button>
          <button onClick={onReset}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-white text-sm font-bold transition-colors"
            style={{ backgroundColor: 'var(--primary)' }}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            {t('bill.newSim')}
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Bill table */}
        <div className="lg:col-span-2 space-y-4">
          {/* Header */}
          <div className="rounded-2xl p-5 text-white" style={{ background: `linear-gradient(to right, var(--dark), var(--dark-alt))` }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-bold text-xs tracking-wider uppercase" style={{ color: 'var(--primary)' }}>Watt Distributors</p>
                <h3 className="text-lg font-bold mt-0.5">{plan.name}</h3>
                <p className="text-blue-200 text-xs mt-0.5">{tdu.name} · {kwh.toLocaleString()} kWh/mes</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-blue-200 text-xs">{lang === 'es' ? 'Total estimado' : 'Estimated total'}</p>
                <p className="text-3xl sm:text-4xl font-extrabold">{fmt(total)}</p>
                <p className="text-blue-200 text-xs mt-0.5">{(effectiveRate * 100).toFixed(3)}¢ {t('bill.effectiveRate')}</p>
              </div>
            </div>
          </div>

          {/* Charges */}
          <LineGroup title={t('bill.chargesTitle')} items={charges.map((i) => ({ label: t(i.labelKey), sublabel: i.sublabel, amount: i.amount }))} subtotalLabel={t('bill.subtotal')} subtotal={subtotal} />

          {/* Taxes */}
          <LineGroup title={t('bill.taxesTitle')} items={taxItems.map((i) => ({ label: t(i.labelKey), sublabel: i.sublabel, amount: i.amount }))} subtotalLabel={t('bill.totalTaxes')} subtotal={taxes} isLight />

          {/* Credits */}
          {credits.length > 0 && (
            <div className="bg-green-50 dark:bg-green-900/10 rounded-2xl border border-green-100 dark:border-green-900 overflow-hidden">
              <div className="px-5 py-3 bg-green-50/60 dark:bg-green-900/20 border-b border-green-100 dark:border-green-900">
                <h4 className="font-bold text-green-700 dark:text-green-400 text-xs uppercase tracking-wide">{t('bill.creditsTitle')}</h4>
              </div>
              {credits.map((item, i) => (
                <div key={i} className="flex items-center justify-between px-5 py-3">
                  <p className="text-sm font-medium text-green-800 dark:text-green-300">{t(item.labelKey)}</p>
                  <p className="text-sm font-bold text-green-700 dark:text-green-400">{fmt(item.amount)}</p>
                </div>
              ))}
            </div>
          )}

          {/* Total */}
          <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--dark)' }}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-blue-200 text-xs uppercase tracking-wide">{t('bill.totalLabel')}</p>
                <p className="text-blue-200/60 text-[10px] mt-0.5">{t('bill.totalIncludes')}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-white text-3xl sm:text-4xl font-extrabold">{fmt(total)}</p>
                <p className="text-blue-200 text-xs mt-0.5">{kwh.toLocaleString()} kWh · {(effectiveRate * 100).toFixed(3)}¢/kWh</p>
              </div>
            </div>
          </div>

          <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed px-1">{t('bill.disclaimer')}</p>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Savings card */}
          <div className={`rounded-2xl p-5 ${isPositive ? 'bg-gradient-to-br from-green-500 to-emerald-600' : 'bg-gradient-to-br from-gray-600 to-gray-700'}`}>
            <p className="text-white/80 text-xs font-semibold uppercase tracking-wide mb-1">
              {isPositive ? t('bill.savingsVsTx') : t('bill.diffVsTx')}
            </p>
            <p className="text-white text-4xl font-extrabold">{fmt(Math.abs(savings))}</p>
            <p className="text-white/80 text-sm mt-1">
              {isPositive ? '+' : '-'}{Math.abs(savingsPercent).toFixed(1)}% {isPositive ? t('bill.cheaper') : t('bill.moreExpensive')}
            </p>
            <div className="mt-3 pt-3 border-t border-white/20">
              <p className="text-white/60 text-xs mb-0.5">{t('bill.txAvg')}</p>
              <p className="text-white font-bold">{fmt(avgTxBill)} <span className="text-white/60 text-xs font-normal">/mes</span></p>
            </div>
          </div>

          {/* Rate comparison */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
            <h4 className="font-bold text-gray-800 dark:text-gray-100 mb-4 text-sm">{t('bill.rateComparison')}</h4>
            <RateBar label={`Watt Distributors (${plan.name})`} rate={effectiveRate} max={avgTxRate} primary />
            <RateBar label={t('bill.txAvgLabel')} rate={avgTxRate} max={avgTxRate} />
          </div>

          {/* Annual projection */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
            <h4 className="font-bold text-gray-800 dark:text-gray-100 mb-4 text-sm">{t('bill.annualProjection')}</h4>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs text-gray-400">{t('bill.withJE')}</p>
                <p className="text-sm font-bold" style={{ color: 'var(--primary)' }}>{fmt(total * 12)}/año</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-400">{t('bill.txLabel')}</p>
                <p className="text-sm font-bold text-gray-500 dark:text-gray-400">{fmt(avgTxBill * 12)}/año</p>
              </div>
            </div>
            {isPositive && (
              <div className="bg-green-50 dark:bg-green-900/10 rounded-xl p-3 text-center mt-3">
                <p className="text-xs text-green-600 dark:text-green-400 font-medium">{t('bill.annualSavings')}</p>
                <p className="text-xl font-extrabold text-green-700 dark:text-green-300">{fmt(savings * 12)}</p>
              </div>
            )}
          </div>

          {/* Plan details */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
            <h4 className="font-bold text-gray-800 dark:text-gray-100 mb-3 text-sm">{t('bill.planDetails')}</h4>
            <div className="space-y-2 text-sm">
              {[
                [t('bill.planLabel'), plan.name],
                [t('bill.energyRate'), `${(plan.rate * 100).toFixed(3)}¢/kWh`],
                [t('bill.baseCharge'), `${fmt(plan.baseCharge)}/mes`],
                [t('bill.contract'), `${plan.termMonths} ${lang === 'es' ? 'meses' : 'months'}`],
                [t('bill.renewableLabel'), plan.renewable ? `✅ ${t('bill.yes')}` : t('bill.no')],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">{k}</span>
                  <span className="font-semibold text-gray-800 dark:text-gray-100 text-right max-w-[55%]">{v}</span>
                </div>
              ))}
              {plan.billCredit && (
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">{t('bill.billCreditLabel')}</span>
                  <span className="font-semibold text-green-700 dark:text-green-400">${plan.billCredit.amount} ≥ {plan.billCredit.threshold.toLocaleString()} kWh</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-gray-100 dark:border-gray-800">
                <span className="text-gray-500 dark:text-gray-400">{t('bill.tduLabel')}</span>
                <span className="font-semibold text-gray-800 dark:text-gray-100 text-right max-w-[60%]">{tdu.name}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LineGroup({ title, items, subtotalLabel, subtotal, isLight }: {
  title: string;
  items: { label: string; sublabel?: string; amount: number }[];
  subtotalLabel: string;
  subtotal: number;
  isLight?: boolean;
}) {
  const fmt2 = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  return (
    <div className={`bg-white dark:bg-gray-900 rounded-2xl border ${isLight ? 'border-gray-100 dark:border-gray-800' : 'border-gray-100 dark:border-gray-800'} shadow-sm overflow-hidden`}>
      <div className="px-5 py-3 bg-gray-50/60 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
        <h4 className="font-bold text-gray-700 dark:text-gray-300 text-xs uppercase tracking-wide">{title}</h4>
      </div>
      <div className="divide-y divide-gray-50 dark:divide-gray-800">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.label}</p>
              {item.sublabel && <p className="text-xs text-gray-400 mt-0.5">{item.sublabel}</p>}
            </div>
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100 ml-4 flex-shrink-0">{fmt2(item.amount)}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between px-5 py-3 bg-gray-50 dark:bg-gray-800/40 border-t border-gray-100 dark:border-gray-700">
        <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{subtotalLabel}</p>
        <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{fmt2(subtotal)}</p>
      </div>
    </div>
  );
}

function RateBar({ label, rate, max, primary }: { label: string; rate: number; max: number; primary?: boolean }) {
  const pct = (rate / max) * 100;
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <span className="font-medium text-gray-600 dark:text-gray-300 truncate max-w-[70%]">{label}</span>
        <span className="font-bold text-gray-700 dark:text-gray-200">{(rate * 100).toFixed(3)}¢/kWh</span>
      </div>
      <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2">
        <div
          className="h-2 rounded-full"
          style={{
            width: `${Math.min(pct, 100)}%`,
            backgroundColor: primary ? 'var(--primary)' : '#9ca3af',
          }}
        />
      </div>
    </div>
  );
}
