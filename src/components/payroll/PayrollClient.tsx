'use client';
import { useState } from 'react';
import { Session } from 'next-auth';
import AppLayout from '@/components/AppLayout';
import { useLanguage } from '@/components/LanguageContext';
import RosterTab from './RosterTab';

/**
 * Payroll → top-level tabs. Block 02 only ships the Roster tab; every
 * other tab is a placeholder that later blocks fill in (03 plan mapping,
 * 04 uploads / Pendientes, 11 approval queue, etc.). Keeping the tabs
 * declared here means the nav doesn't need to be rebuilt each block.
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
  const [tab, setTab] = useState<PayrollTab>('roster');

  return (
    <AppLayout session={session}>
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-4 overflow-x-hidden">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{t('payroll.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('payroll.subtitle')}</p>
        </div>

        {/* Tab switcher — scrolls horizontally on mobile because there are 11 tabs */}
        <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700 overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
          {TABS.map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap flex-shrink-0 ${
                tab === id
                  ? 'border-[var(--primary)] text-[var(--primary)]'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {t(`payroll.tab_${id}`)}
            </button>
          ))}
        </div>

        {/* Tab body */}
        {tab === 'roster'
          ? <RosterTab session={session} />
          : <PlaceholderTab tabKey={tab} />}
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
