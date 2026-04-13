'use client';
import { useState, useCallback } from 'react';
import { Session } from 'next-auth';
import { TDUs, PLANS, calculateBill, BillResult, Plan, TDU } from '@/lib/rates';
import BillBreakdown from './BillBreakdown';
import AppLayout from './AppLayout';
import { useLanguage } from './LanguageContext';

export default function SimulatorClient({ session }: { session: Session }) {
  const { t, lang } = useLanguage();
  const [customerName, setCustomerName] = useState('');
  const [kwh, setKwh] = useState(1000);
  const [kwhInput, setKwhInput] = useState('1000');
  const [selectedTdu, setSelectedTdu] = useState<TDU>(TDUs[0]);
  const [selectedPlan, setSelectedPlan] = useState<Plan>(PLANS[0]);
  const [result, setResult] = useState<BillResult | null>(null);

  const handleKwhSlider = (v: number) => { setKwh(v); setKwhInput(String(v)); };
  const handleKwhInput = (v: string) => {
    setKwhInput(v);
    const n = parseInt(v, 10);
    if (!isNaN(n) && n >= 0 && n <= 5000) setKwh(n);
  };

  const simulate = useCallback(() => {
    const name = customerName.trim() || t('simulator.defaultCustomerName');
    setResult(calculateBill(name, kwh, selectedTdu, selectedPlan, false, lang));
  }, [customerName, kwh, selectedTdu, selectedPlan, lang]);

  const reset = () => {
    setResult(null);
    setCustomerName('');
    setKwh(1000);
    setKwhInput('1000');
    setSelectedTdu(TDUs[0]);
    setSelectedPlan(PLANS[0]);
  };

  return (
    <AppLayout session={session}>
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8">
        {!result ? (
          <div className="grid lg:grid-cols-3 gap-4 sm:gap-6">
            {/* Inputs column */}
            <div className="lg:col-span-1 space-y-4">
              {/* Step 1: Customer */}
              <Card step="1" title={t('simulator.step1')}>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">{t('simulator.customerName')}</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder={t('simulator.customerPlaceholder')}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm placeholder-gray-400"
                />
              </Card>

              {/* Step 2: kWh */}
              <Card step="2" title={t('simulator.step2')}>
                <div className="flex items-center gap-3 mb-3">
                  <input
                    type="number"
                    min={0} max={5000}
                    value={kwhInput}
                    onChange={(e) => handleKwhInput(e.target.value)}
                    className="w-24 px-2 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-bold text-xl text-center focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                  />
                  <span className="text-gray-500 dark:text-gray-400 text-sm font-medium">{t('simulator.kwhUnit')}</span>
                </div>
                <input
                  type="range" min={0} max={5000} step={50} value={kwh}
                  onChange={(e) => handleKwhSlider(Number(e.target.value))}
                  className="w-full accent-[var(--primary)]"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1 mb-3"><span>0</span><span>2,500</span><span>5,000</span></div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[500, 1000, 1500, 2000, 2500, 3000].map((v) => (
                    <button key={v} onClick={() => handleKwhSlider(v)}
                      className="py-1.5 rounded-lg text-xs font-semibold transition-colors"
                      style={kwh === v
                        ? { backgroundColor: 'var(--primary)', color: '#fff' }
                        : {}
                      }
                      onMouseEnter={(e) => { if (kwh !== v) e.currentTarget.style.backgroundColor = 'var(--primary-light)'; }}
                      onMouseLeave={(e) => { if (kwh !== v) e.currentTarget.style.backgroundColor = ''; }}
                    >
                      <span className={kwh !== v ? 'text-gray-600 dark:text-gray-300' : ''}>{v.toLocaleString()}</span>
                    </button>
                  ))}
                </div>
              </Card>
            </div>

            {/* TDU + Plan */}
            <div className="lg:col-span-2 space-y-4">
              {/* Step 3: TDU */}
              <Card step="3" title={t('simulator.step3')}>
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                  {TDUs.map((tdu) => {
                    const active = selectedTdu.id === tdu.id;
                    return (
                      <button key={tdu.id} onClick={() => setSelectedTdu(tdu)}
                        className="p-3.5 rounded-xl border-2 text-left transition-all"
                        style={active
                          ? { borderColor: 'var(--primary)', backgroundColor: 'var(--primary-light)' }
                          : { borderColor: 'transparent', backgroundColor: 'transparent' }
                        }
                        onMouseEnter={(e) => { if (!active) e.currentTarget.style.borderColor = '#d1d5db'; }}
                        onMouseLeave={(e) => { if (!active) e.currentTarget.style.borderColor = 'transparent'; }}
                      >
                        <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm leading-tight">{tdu.name}</p>
                        <p className="text-xs text-gray-400 mt-1 leading-tight">{tdu.region}</p>
                        <p className="text-xs font-bold mt-2" style={{ color: 'var(--primary)' }}>${tdu.customerCharge.toFixed(2)}{t('simulator.perMonthBase')}</p>
                      </button>
                    );
                  })}
                </div>
              </Card>

              {/* Step 4: Plan */}
              <Card step="4" title={t('simulator.step4')}>
                <div className="grid sm:grid-cols-2 gap-3">
                  {PLANS.map((plan) => {
                    const active = selectedPlan.id === plan.id;
                    return (
                      <button key={plan.id} onClick={() => setSelectedPlan(plan)}
                        className="p-4 rounded-xl border-2 text-left transition-all relative"
                        style={active
                          ? { borderColor: 'var(--primary)', backgroundColor: 'var(--primary-light)' }
                          : { borderColor: 'transparent' }
                        }
                        onMouseEnter={(e) => { if (!active) e.currentTarget.style.borderColor = '#d1d5db'; }}
                        onMouseLeave={(e) => { if (!active) e.currentTarget.style.borderColor = 'transparent'; }}
                      >
                        {plan.badge && (
                          <span className="absolute top-3 right-3 text-[9px] font-extrabold tracking-wider text-white px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--primary)' }}>
                            {plan.badge[lang]}
                          </span>
                        )}
                        <p className="font-bold text-gray-800 dark:text-gray-100 text-sm">{plan.name}</p>
                        <p className="text-2xl font-extrabold mt-1" style={{ color: 'var(--primary)' }}>
                          {(plan.rate * 100).toFixed(1)}¢<span className="text-xs font-normal text-gray-400">/kWh</span>
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{plan.description[lang]}</p>
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          <span className="text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full px-2 py-0.5 font-medium">{plan.termMonths} {t('simulator.months')}</span>
                          {plan.renewable && <span className="text-[10px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full px-2 py-0.5 font-medium">🌱 {t('simulator.renewable')}</span>}
                          {plan.billCredit && <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-full px-2 py-0.5 font-medium">${plan.billCredit.amount} {t('simulator.credit')}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Card>

              {/* CTA */}
              <button
                onClick={simulate}
                disabled={kwh === 0}
                className="w-full py-4 rounded-2xl text-white font-bold text-base sm:text-lg shadow-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ background: `linear-gradient(to right, var(--primary), var(--primary-hover))` }}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                {t('simulator.calculateBtn')}
              </button>
            </div>
          </div>
        ) : (
          <BillBreakdown result={result} onReset={reset} agentName={session.user.name} />
        )}
      </div>
    </AppLayout>
  );
}

function Card({ step, title, children }: { step: string; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 sm:p-5">
      <h3 className="font-bold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2 text-sm">
        <span className="w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center" style={{ backgroundColor: 'var(--primary)' }}>{step}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}
