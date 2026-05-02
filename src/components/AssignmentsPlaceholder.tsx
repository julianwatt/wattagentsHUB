'use client';
import { useLanguage } from './LanguageContext';

interface Props { messageKey: string; }

export default function AssignmentsPlaceholder({ messageKey }: Props) {
  const { t } = useLanguage();
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm py-16 text-center px-4">
      <p className="text-3xl mb-3">🚧</p>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
        {t(messageKey)}
      </p>
    </div>
  );
}
