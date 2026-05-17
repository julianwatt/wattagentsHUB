'use client';
import { useState, useEffect, useCallback } from 'react';
import { Session } from 'next-auth';
import AppLayout from '@/components/AppLayout';
import { useLanguage } from '@/components/LanguageContext';
import RosterTab from './RosterTab';
import PlanMappingTab from './PlanMappingTab';
import PendientesTab from './PendientesTab';
import PublicadasTab from './PublicadasTab';

/**
 * Payroll → top-level tabs. Blocks ship them one by one:
 *   - Block 02: Roster
 *   - Block 03: Plan Mapping
 *   - Blocks 04+: the rest (Pendientes, Aprobación, etc.)
 *
 * Tabs that are not yet implemented render a placeholder. Tab declaration
 * stays here so the nav doesn't need to be rebuilt each block.
 */
const TABS = [
  'pendientes',
  'aprobacion',
  'publicadas',
  'roster',
  'plan_mapping',
  'saldos_negativos',
  'collections',
  'bonos',
  'residuales',
  'rastreo',
  'audit_log',
] as const;
type PayrollTab = (typeof TABS)[number];

export default function PayrollClient({ session }: { session: Session }) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<PayrollTab>('pendientes');
  const [pendingPlansCount, setPendingPlansCount] = useState(0);

  // Cheap polling for the pending count so the badge stays fresh on every
  // tab. The pending list is small (unique plan_names sitting on VERIFY),
  // and the underlying query is indexed by status, so the cost is trivial.
  // We poll on focus + every 60s instead of subscribing to realtime to
  // avoid an extra realtime channel for a feature that doesn't need
  // sub-second responsiveness.
  const refreshPending = useCallback(async () => {
    try {
      const r = await fetch('/api/payroll/plan-mappings?pending=1');
      if (r.ok) {
        const j = await r.json();
        setPendingPlansCount(Array.isArray(j) ? j.length : 0);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    refreshPending();
    const interval = setInterval(refreshPending, 60_000);
    const onFocus = () => refreshPending();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshPending]);

  return (
    <AppLayout session={session}>
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-4 overflow-x-hidden">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{t('payroll.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('payroll.subtitle')}</p>
        </div>

        {/* Tab switcher — scrolls horizontally on mobile because there are 11 tabs */}
        <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700 overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
          {TABS.map((id) => {
            const showBadge = id === 'plan_mapping' && pendingPlansCount > 0;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap flex-shrink-0 inline-flex items-center gap-1.5 ${
                  tab === id
                    ? 'border-[var(--primary)] text-[var(--primary)]'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {t(`payroll.tab_${id}`)}
                {showBadge && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-rose-600 text-white text-[10px] font-bold px-1">
                    {pendingPlansCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab body */}
        {tab === 'pendientes' && <PendientesTab />}
        {tab === 'publicadas' && <PublicadasTab />}
        {tab === 'roster' && <RosterTab session={session} />}
        {tab === 'plan_mapping' && <PlanMappingTab onPendingCountChange={setPendingPlansCount} />}
        {tab !== 'pendientes' && tab !== 'publicadas' && tab !== 'roster' && tab !== 'plan_mapping' && <PlaceholderTab tabKey={tab} />}
      </div>
    </AppLayout>
  );
}

function PlaceholderTab({ tabKey }: { tabKey: PayrollTab }) {
  const { t } = useLanguage();
  return (
    <div className="text-center py-20">
      <p className="text-4xl mb-3">🚧</p>
      <p className="text-gray-600 dark:text-gray-300 font-medium">{t(`payroll.tab_${tabKey}`)}</p>
      <p className="text-sm text-gray-400 mt-1">{t('payroll.tabPlaceholder')}</p>
    </div>
  );
}
