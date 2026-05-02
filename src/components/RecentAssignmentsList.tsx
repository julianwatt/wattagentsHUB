'use client';
import { useEffect, useState, useCallback } from 'react';
import { useLanguage } from './LanguageContext';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import type { AssignmentFormPreset } from './AssignmentForm';

interface AssignmentRow {
  id: string;
  agent_id: string;
  store_id: string;
  shift_date: string;
  scheduled_start_time: string;
  expected_duration_min: number;
  status: string;
  created_at: string;
  rejection_reason: string | null;
  agent: { id: string; name: string; username: string } | null;
  store: { id: string; name: string; address: string | null } | null;
}

interface Props {
  /** Bumped by parent after a successful create to force a refresh. */
  refreshKey: number;
  /** Called when the user clicks "Reasignar" on a rejected row. */
  onReassign: (preset: AssignmentFormPreset) => void;
}

const STATUS_BADGE: Record<string, { color: string; labelKey: string }> = {
  pending:     { color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300', labelKey: 'assignments.statusPending' },
  accepted:    { color: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300', labelKey: 'assignments.statusAccepted' },
  rejected:    { color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300', labelKey: 'assignments.statusRejected' },
  in_progress: { color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300', labelKey: 'assignments.statusInProgress' },
  completed:   { color: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300', labelKey: 'assignments.statusCompleted' },
  incomplete:  { color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300', labelKey: 'assignments.statusIncomplete' },
  cancelled:   { color: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300', labelKey: 'assignments.statusCancelled' },
};

const todayLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function RecentAssignmentsList({ refreshKey, onReassign }: Props) {
  const { t } = useLanguage();
  const [items, setItems] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRecent = useCallback(async () => {
    setLoading(true);
    try {
      const today = todayLocal();
      // "Asignaciones creadas hoy por mí" — created_at within today, by me.
      // We use shift_date>=today as a proxy plus assigned_by_me=1.
      const res = await fetch(
        `/api/assignments?from=${today}&assigned_by_me=1&limit=50`,
        { cache: 'no-store' },
      );
      if (res.ok) {
        const data = await res.json();
        setItems(data.assignments ?? []);
      }
    } catch {
      /* silent */
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchRecent(); }, [fetchRecent, refreshKey]);

  // Realtime subscription — react when an agent accepts/rejects/etc
  useEffect(() => {
    const sb = getSupabaseBrowser();
    const channel = sb
      .channel('recent-assignments-rt')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'assignments' },
        () => { fetchRecent(); },
      )
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [fetchRecent]);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
        <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm flex items-center gap-2">
          <span>🗓️</span> {t('assignments.recentTitle')}
        </h3>
        <span className="text-[11px] text-gray-400">{items.length}</span>
      </div>

      {loading ? (
        <div className="px-4 py-8 text-center text-xs text-gray-400">{t('common.loading')}</div>
      ) : items.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-gray-400">
          {t('assignments.recentEmpty')}
        </div>
      ) : (
        <ul className="divide-y divide-gray-50 dark:divide-gray-800">
          {items.map((a) => {
            const badge = STATUS_BADGE[a.status] ?? STATUS_BADGE.pending;
            return (
              <li key={a.id} className="px-4 sm:px-5 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
                      {a.agent?.name ?? '—'}
                    </p>
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${badge.color}`}>
                      {t(badge.labelKey)}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 tabular-nums">
                    {a.store?.name ?? '—'} · {a.shift_date} · {a.scheduled_start_time}
                  </p>
                  {a.status === 'rejected' && a.rejection_reason && (
                    <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5 italic">
                      &ldquo;{a.rejection_reason}&rdquo;
                    </p>
                  )}
                </div>
                {a.status === 'rejected' && (
                  <button
                    onClick={() =>
                      onReassign({
                        agent_id: a.agent_id,
                        store_id: a.store_id,
                        shift_date: a.shift_date,
                        scheduled_start_time: a.scheduled_start_time,
                        expected_duration_min: a.expected_duration_min,
                      })
                    }
                    className="flex-shrink-0 text-[11px] font-bold px-2.5 py-1.5 rounded-lg text-white transition-colors"
                    style={{ backgroundColor: 'var(--primary)' }}
                  >
                    {t('assignments.reassignBtn')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
