'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from './LanguageContext';
import { fmtDateTime } from '@/lib/i18n';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

/**
 * Block 15 — Per-user notifications bell.
 *
 * Sits next to the admin bell in AppLayout. Visible to every logged-in
 * role; reads from /api/user-notifications (scoped to the caller).
 *
 * Inbox content comes from user_notifications (the universal recipient
 * table — agents see their payfile_published, managers see their team
 * triggers, CEO sees week_ready_for_approval / large_change_republish).
 */

interface UserNotif {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  status: 'pending' | 'read' | 'dismissed';
  created_at: string;
  read_at: string | null;
}

interface Props {
  userId: string;
}

export default function UserNotificationsBell({ userId }: Props) {
  const { t, lang } = useLanguage();
  const [items, setItems] = useState<UserNotif[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const fetchItems = useCallback(async () => {
    try {
      const r = await fetch('/api/user-notifications');
      if (r.ok) {
        const j = await r.json();
        setItems(j.notifications ?? []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchItems();
    const sb = getSupabaseBrowser();
    const channel = sb.channel(`user-notifs-${userId}`).on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_notifications', filter: `recipient_user_id=eq.${userId}` },
      () => { fetchItems(); },
    ).subscribe();
    return () => { sb.removeChannel(channel); };
  }, [fetchItems, userId]);

  useEffect(() => {
    function onClickOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOut);
    return () => document.removeEventListener('mousedown', onClickOut);
  }, []);

  const markRead = async (id: string) => {
    await fetch('/api/user-notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    setItems((prev) => prev.map((n) => n.id === id ? { ...n, status: 'read', read_at: new Date().toISOString() } : n));
  };

  const markAll = async () => {
    await fetch('/api/user-notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markAll: true }),
    });
    setItems((prev) => prev.map((n) => ({ ...n, status: 'read' as const, read_at: new Date().toISOString() })));
  };

  const pending = items.filter((n) => n.status === 'pending').length;
  const urlOf = (n: UserNotif): string | null => {
    const u = (n.data as { url?: string } | null)?.url;
    return typeof u === 'string' && u.length > 0 ? u : null;
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        title={t('userBell.title')}
        className="w-8 h-8 flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors relative"
      >
        <BellIcon className="w-4 h-4" />
        {pending > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-500 text-[10px] font-bold text-white flex items-center justify-center leading-none">
            {pending > 9 ? '9+' : pending}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-10 w-72 sm:w-80 bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <h4 className="text-xs font-bold text-gray-800 dark:text-gray-100">{t('userBell.title')}</h4>
            <div className="flex items-center gap-1.5">
              {pending > 0 && (
                <>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">{pending}</span>
                  <button onClick={markAll} className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                    {t('userBell.markAllRead')}
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-gray-50 dark:divide-gray-800">
            {items.length === 0 ? (
              <p className="text-xs text-gray-400 px-4 py-6 text-center">{t('userBell.empty')}</p>
            ) : items.slice(0, 10).map((n) => {
              const url = urlOf(n);
              const inner = (
                <div className={`px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors ${n.status === 'pending' ? 'bg-emerald-50/40 dark:bg-emerald-900/10' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{n.title}</p>
                      {n.body && <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">{n.body}</p>}
                      <p className="text-[10px] text-gray-400 mt-0.5">{fmtDateTime(n.created_at, lang)}</p>
                    </div>
                    {n.status === 'pending' && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 flex-shrink-0">!</span>
                    )}
                  </div>
                </div>
              );
              return url ? (
                <Link key={n.id} href={url} onClick={() => { setOpen(false); if (n.status === 'pending') markRead(n.id); }}>
                  {inner}
                </Link>
              ) : (
                <button key={n.id} onClick={() => { if (n.status === 'pending') markRead(n.id); }} className="block w-full text-left">
                  {inner}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function BellIcon({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
}
