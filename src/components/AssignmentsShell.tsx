'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Session } from 'next-auth';
import AppLayout from './AppLayout';
import { useLanguage } from './LanguageContext';

type TabKey = 'today' | 'new' | 'history';

const TABS: { key: TabKey; href: string; labelKey: string }[] = [
  { key: 'today',   href: '/assignments/today',   labelKey: 'assignments.tabToday' },
  { key: 'new',     href: '/assignments/new',     labelKey: 'assignments.tabNew' },
  { key: 'history', href: '/assignments/history', labelKey: 'assignments.tabHistory' },
];

interface Props {
  session: Session;
  children: React.ReactNode;
}

export default function AssignmentsShell({ session, children }: Props) {
  const { t } = useLanguage();
  const pathname = usePathname();

  const activeTab: TabKey =
    pathname?.startsWith('/assignments/new') ? 'new'
    : pathname?.startsWith('/assignments/history') ? 'history'
    : 'today';

  return (
    <AppLayout session={session}>
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('assignments.title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {t('assignments.subtitle')}
          </p>
        </div>

        {/* Tab bar — horizontally scrollable on narrow widths so it never
            forces the page to scroll. Visual style mirrors NotificationsClient. */}
        <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700 overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0 scrollbar-none">
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <Link
                key={tab.key}
                href={tab.href}
                className={`px-3 sm:px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap ${
                  active
                    ? 'border-[var(--primary)] text-[var(--primary)]'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {t(tab.labelKey)}
              </Link>
            );
          })}
        </div>

        <div>{children}</div>
      </div>
    </AppLayout>
  );
}
