'use client';
import { Session } from 'next-auth';
import AppLayout from './AppLayout';
import { useLanguage } from './LanguageContext';
import ShiftPanel from './ShiftPanel';

export default function ShiftClient({ session }: { session: Session }) {
  const { t } = useLanguage();
  const role = session.user.role as string;
  const allowed = ['agent', 'jr_manager', 'sr_manager'].includes(role);

  return (
    <AppLayout session={session}>
      {allowed ? (
        <div className="max-w-2xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
          <ShiftPanel userId={session.user.id} />
        </div>
      ) : (
        <div className="max-w-2xl mx-auto px-4 py-12 text-center">
          <p className="text-gray-500 dark:text-gray-400 text-sm">{t('shift.noAccess')}</p>
        </div>
      )}
    </AppLayout>
  );
}
