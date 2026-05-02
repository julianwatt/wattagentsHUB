'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Session } from 'next-auth';
import AppLayout from './AppLayout';
import InfoTooltip from './InfoTooltip';
import { useLanguage } from './LanguageContext';
import { usePreviewRole, useActiveUserId } from './PreviewRoleContext';
import { useShift } from './ShiftContext';
import { fmtDate, fmtTime } from '@/lib/i18n';
import { ActivityEntry, CampaignType, effectivenessRate, getAllowedActivityModalities } from '@/lib/activity';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

type Modality = 'd2d' | 'retail' | 'both';

/** Per-date assignment context used by Retail-mode UX. */
interface AssignmentForDate {
  id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'in_progress' | 'completed' | 'incomplete' | 'cancelled';
  store_name: string;
  store_address: string | null;
}

// Use local date (not UTC) — toISOString() shifts day when UTC > local date
const today = () => new Date().toLocaleDateString('en-CA');

const STORE_CHAINS = ['Walmart', 'HEB', "Sam's Club", 'El Rancho Supermercado', 'La Michoacana', 'Fiesta Mart', 'Otro'];

type D2DKey = 'knocks' | 'contacts' | 'bills' | 'sales';
type RetailKey = 'stops' | 'zipcodes' | 'credit_checks' | 'sales';

const D2D_FIELDS: Array<{ key: D2DKey; goal?: number; icon: string; labelKey: string; subKey: string }> = [
  { key: 'knocks',   goal: 100, icon: '🚪', labelKey: 'activity.d2dKnocksLabel',   subKey: 'activity.d2dKnocksSub' },
  { key: 'contacts', goal: 30,  icon: '🤝', labelKey: 'activity.d2dContactsLabel', subKey: 'activity.d2dContactsSub' },
  { key: 'bills',    goal: undefined, icon: '📄', labelKey: 'activity.d2dBillsLabel',   subKey: 'activity.d2dBillsSub' },
  { key: 'sales',    goal: undefined, icon: '✅', labelKey: 'activity.d2dSalesLabel',   subKey: 'activity.d2dSalesSub' },
];

const RETAIL_FIELDS: Array<{ key: RetailKey; goal?: number; icon: string; labelKey: string; subKey: string }> = [
  { key: 'stops',         goal: 100, icon: '🛒', labelKey: 'activity.rtlStopsLabel',        subKey: 'activity.rtlStopsSub' },
  { key: 'zipcodes',      goal: 30,  icon: '📍', labelKey: 'activity.rtlZipcodesLabel',     subKey: 'activity.rtlZipcodesSub' },
  { key: 'credit_checks', goal: undefined, icon: '💳', labelKey: 'activity.rtlCreditChecksLabel', subKey: 'activity.rtlCreditChecksSub' },
  { key: 'sales',         goal: undefined, icon: '✅', labelKey: 'activity.rtlSalesLabel',        subKey: 'activity.rtlSalesSub' },
];

const EMPTY_D2D = { knocks: 0, contacts: 0, bills: 0, sales: 0 };
const EMPTY_RETAIL = { stops: 0, zipcodes: 0, credit_checks: 0, sales: 0 };
const draftKey = (userId: string) => `watt_activity_draft_${userId}`;

export default function ActivityClient({ session }: { session: Session }) {
  const { t, lang } = useLanguage();
  const { previewUserName } = usePreviewRole();
  const { activeUserId, isPreviewMode } = useActiveUserId(session.user.id);
  const { store: shiftStore, shiftState } = useShift();

  // Fetch real user name + modality from DB
  const [dbUserName, setDbUserName] = useState<string>(previewUserName ?? session.user.name ?? '');
  const [userModality, setUserModality] = useState<Modality>('d2d');
  const [modalityLoaded, setModalityLoaded] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const sb = getSupabaseBrowser();
        const { data } = await sb.from('users').select('name, modality').eq('id', activeUserId).single();
        if (!previewUserName && data?.name) setDbUserName(data.name);
        if (data?.modality) setUserModality(data.modality as Modality);
      } catch {}
      setModalityLoaded(true);
    })();
  }, [activeUserId, previewUserName]);

  // Per-date assignment context (only relevant when Retail is in play)
  const [assignmentForDate, setAssignmentForDate] = useState<AssignmentForDate | null>(null);
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [assignmentLoaded, setAssignmentLoaded] = useState(false);
  const loadAssignmentForDate = useCallback(async (d: string) => {
    setAssignmentLoading(true);
    try {
      const sb = getSupabaseBrowser();
      // Pull only assignments whose status is "live" (matches the server-side
      // resolveActiveAssignment) so a stale cancelled/rejected row never wins
      // over a fresh live one — order by created_at desc still applies.
      const { data } = await sb
        .from('assignments')
        .select('id, status, store:stores(name, address)')
        .eq('agent_id', activeUserId)
        .eq('shift_date', d)
        .in('status', ['accepted', 'in_progress', 'completed', 'incomplete'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        const store = data.store as unknown as { name: string; address: string | null } | null;
        setAssignmentForDate({
          id: data.id,
          status: data.status as AssignmentForDate['status'],
          store_name: store?.name ?? '—',
          store_address: store?.address ?? null,
        });
      } else {
        setAssignmentForDate(null);
      }
    } catch {
      setAssignmentForDate(null);
    }
    setAssignmentLoading(false);
    setAssignmentLoaded(true);
  }, [activeUserId]);

  // If admin visits /activity without preview mode, redirect to /admin
  const isRealAdmin = session.user.role === 'admin';
  // Check localStorage for preview role (same key as PreviewRoleContext)
  const [adminAllowed, setAdminAllowed] = useState(!isRealAdmin);
  useEffect(() => {
    if (!isRealAdmin) return;
    try {
      const hasRole = localStorage.getItem('wattPreviewRole');
      const hasUser = localStorage.getItem('wattPreviewUser');
      if (hasRole || hasUser) setAdminAllowed(true);
      else window.location.href = '/admin';
    } catch { window.location.href = '/admin'; }
  }, [isRealAdmin]);
  const [date, setDate] = useState(today());
  const [campaignType, setCampaignType] = useState<CampaignType>('D2D');
  const [zipCode, setZipCode] = useState('');
  const [storeChain, setStoreChain] = useState(STORE_CHAINS[0]);
  const [storeAddress, setStoreAddress] = useState('');
  const [d2d, setD2d] = useState({ ...EMPTY_D2D });
  const [retail, setRetail] = useState({ ...EMPTY_RETAIL });
  const [history, setHistory] = useState<ActivityEntry[]>([]);
  const [todayEntry, setTodayEntry] = useState<ActivityEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [incrementing, setIncrementing] = useState<string | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Active shift store — from global ShiftContext (single source of truth)
  const shiftStoreName = shiftState !== 'idle' ? shiftStore?.name ?? null : null;
  const shiftStoreAddress = shiftState !== 'idle' ? shiftStore?.address ?? null : null;

  // Sync shift store into the activity form fields when shift is active
  useEffect(() => {
    if (shiftStoreName) {
      setStoreChain(shiftStoreName);
      setStoreAddress(shiftStoreAddress ?? '');
    }
  }, [shiftStoreName, shiftStoreAddress]);

  const loadEntry = useCallback(async (d: string) => {
    console.log('[Activity loadEntry]', { activeUserId, date: d, isPreviewMode });
    const res = await fetch(`/api/activity?agentId=${activeUserId}&date=${d}`);
    if (res.ok) {
      const entry: ActivityEntry | null = await res.json();
      if (entry) {
        applyEntry(entry);
        if (d === today()) setTodayEntry(entry);
      } else {
        setD2d({ ...EMPTY_D2D });
        setRetail({ ...EMPTY_RETAIL });
        if (d === today()) setTodayEntry(null);
      }
    }
  }, [activeUserId]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    console.log('[Activity loadHistory]', { activeUserId, isPreviewMode });
    const url = isPreviewMode
      ? `/api/activity?asUser=${activeUserId}`
      : '/api/activity';
    const res = await fetch(url);
    if (res.ok) {
      const data: ActivityEntry[] = await res.json();
      setHistory(data);
      const te = data.find((e) => e.date === today());
      if (te) { setTodayEntry(te); applyEntry(te); }
    }
    setLoading(false);
  }, [activeUserId, isPreviewMode]);

  function applyEntry(entry: ActivityEntry) {
    setD2d({ knocks: entry.knocks, contacts: entry.contacts, bills: entry.bills, sales: entry.sales });
    setRetail({ stops: entry.stops, zipcodes: entry.zipcodes, credit_checks: entry.credit_checks, sales: entry.sales });
    setCampaignType(entry.campaign_type);
    setZipCode(entry.zip_code ?? '');
    setStoreChain(entry.store_chain ?? STORE_CHAINS[0]);
    setStoreAddress(entry.store_address ?? '');
  }

  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => { loadEntry(date); }, [date, loadEntry]);
  useEffect(() => { loadAssignmentForDate(date); }, [date, loadAssignmentForDate]);

  // Single source of truth for which campaigns the agent may register today.
  // Centralized so the UI, the +/- log endpoint and the upsert endpoint all
  // agree. See lib/activity.ts → getAllowedActivityModalities for the table.
  //
  // Don't compute until BOTH modality + assignment have finished loading.
  // Otherwise the first render flashes "D2D" before the assignment query
  // resolves, and any concurrent applyEntry() call could lock that flash in.
  const formReady = modalityLoaded && assignmentLoaded;
  const hasActiveAssignment =
    !!assignmentForDate
    && (assignmentForDate.status === 'accepted' || assignmentForDate.status === 'in_progress');
  const allowedModalities: CampaignType[] = formReady
    ? getAllowedActivityModalities(userModality, hasActiveAssignment)
    : ['D2D']; // placeholder while the form is gated below
  const showCampaignSelector = allowedModalities.length > 1;

  // Snap campaignType into the allowed set whenever ANY input changes —
  // including campaignType itself (catches stale values written by
  // applyEntry() after a server fetch). Once it lands inside the set the
  // .includes() check is true and the effect is a no-op.
  useEffect(() => {
    if (!formReady) return;
    if (!allowedModalities.includes(campaignType)) {
      setCampaignType(allowedModalities[0]);
    }
  }, [formReady, allowedModalities, campaignType]);

  // Restore localStorage draft once initial load is done and no DB entry exists for today
  useEffect(() => {
    if (loading) return;
    if (todayEntry) return;
    if (date !== today()) return;
    if (isPreviewMode) return;
    try {
      const raw = localStorage.getItem(draftKey(activeUserId));
      if (!raw) return;
      const draft = JSON.parse(raw) as {
        d2d: typeof EMPTY_D2D;
        retail: typeof EMPTY_RETAIL;
        zipCode: string;
        storeChain: string;
        storeAddress: string;
        campaignType: CampaignType;
      };
      setD2d(draft.d2d ?? EMPTY_D2D);
      setRetail(draft.retail ?? EMPTY_RETAIL);
      setZipCode(draft.zipCode ?? '');
      setStoreChain(draft.storeChain ?? STORE_CHAINS[0]);
      setStoreAddress(draft.storeAddress ?? '');
      setCampaignType(draft.campaignType ?? 'D2D');
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, todayEntry?.id, date, activeUserId, isPreviewMode]);

  // Save draft to localStorage every 5s for offline recovery
  useEffect(() => {
    if (isPreviewMode) return;
    const id = setInterval(() => {
      if (date !== today()) return;
      try {
        localStorage.setItem(draftKey(activeUserId), JSON.stringify({
          d2d, retail, zipCode, storeChain, storeAddress, campaignType,
        }));
      } catch {}
    }, 5000);
    return () => clearInterval(id);
  }, [d2d, retail, zipCode, storeChain, storeAddress, campaignType, date, activeUserId, isPreviewMode]);

  // Clear draft on successful save
  useEffect(() => {
    if (!success) return;
    try { localStorage.removeItem(draftKey(activeUserId)); } catch {}
  }, [success, activeUserId]);

  // Realtime subscription
  useEffect(() => {
    const sb = getSupabaseBrowser();
    const channel = sb
      .channel('activity-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'activity_entries',
        filter: `agent_id=eq.${activeUserId}`,
      }, (payload) => {
        const entry = payload.new as ActivityEntry;
        if (!entry?.date) return;
        setHistory((prev) => {
          const idx = prev.findIndex((e) => e.date === entry.date);
          if (idx >= 0) { const next = [...prev]; next[idx] = entry; return next; }
          return [entry, ...prev].sort((a, b) => b.date.localeCompare(a.date));
        });
        if (entry.date === today()) { setTodayEntry(entry); applyEntry(entry); }
        if (entry.date === date) applyEntry(entry);
      })
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [activeUserId, date]);

  // +/- click → immediate API call
  const handleIncrement = async (field: string, delta: 1 | -1) => {
    const key = `${field}${delta}`;
    setIncrementing(key);
    const res = await fetch('/api/activity/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date,
        campaignType,
        field,
        delta,
        zip_code: campaignType === 'D2D' ? zipCode : undefined,
        store_chain: campaignType === 'Retail' ? storeChain : undefined,
        store_address: campaignType === 'Retail' ? storeAddress : undefined,
      }),
    });
    if (res.ok) {
      const entry: ActivityEntry = await res.json();
      applyEntry(entry);
      setHistory((prev) => {
        const idx = prev.findIndex((e) => e.date === entry.date);
        if (idx >= 0) { const next = [...prev]; next[idx] = entry; return next; }
        return [entry, ...prev].sort((a, b) => b.date.localeCompare(a.date));
      });
      if (entry.date === today()) setTodayEntry(entry);
    } else {
      const body = await res.json().catch(() => ({}));
      if (body.error === 'CAMPAIGN_LOCKED') {
        setSaveError(t('activity.campaignLocked'));
      }
    }
    setIncrementing(null);
  };

  const doSave = useCallback(async (
    d: string, ct: CampaignType,
    metricsD2D: typeof EMPTY_D2D, metricsRetail: typeof EMPTY_RETAIL,
    zip: string, chain: string, addr: string,
  ) => {
    setSaving(true); setSuccess(false); setSaveError('');
    const metrics = ct === 'D2D' ? metricsD2D : metricsRetail;
    const res = await fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: d, campaignType: ct,
        zip_code: ct === 'D2D' ? zip : undefined,
        store_chain: ct === 'Retail' ? chain : undefined,
        store_address: ct === 'Retail' ? addr : undefined,
        ...metrics,
      }),
    });
    setSaving(false);
    if (res.ok) {
      const entry: ActivityEntry = await res.json();
      applyEntry(entry);
      setHistory((prev) => {
        const idx = prev.findIndex((e) => e.date === entry.date);
        if (idx >= 0) { const next = [...prev]; next[idx] = entry; return next; }
        return [entry, ...prev].sort((a, b) => b.date.localeCompare(a.date));
      });
      if (entry.date === today()) setTodayEntry(entry);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } else {
      const body = await res.json().catch(() => ({}));
      if (body.error === 'CAMPAIGN_LOCKED') {
        setSaveError(t('activity.campaignLocked'));
      } else {
        setSaveError(body.error || t('activity.saveError'));
      }
    }
  }, [t]);

  const handleDelete = async (entry: ActivityEntry) => {
    if (!confirm(t('activity.deleteConfirm'))) return;
    await fetch('/api/activity', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: entry.date }),
    });
    setHistory((prev) => prev.filter((e) => e.date !== entry.date));
    if (entry.date === today()) setTodayEntry(null);
    if (entry.date === date) { setD2d({ ...EMPTY_D2D }); setRetail({ ...EMPTY_RETAIL }); }
  };

  const fields = campaignType === 'D2D' ? D2D_FIELDS : RETAIL_FIELDS;
  const metrics = campaignType === 'D2D' ? d2d : retail;

  // Retail logging requires an active accepted assignment for the date.
  // Disable the +/- buttons when one isn't present.
  const retailReady = campaignType !== 'Retail'
    || (assignmentForDate && ['accepted', 'in_progress', 'completed', 'incomplete'].includes(assignmentForDate.status));
  const retailBlocked = campaignType === 'Retail' && !retailReady;

  const scheduleAutoSave = useCallback((
    d: string, ct: CampaignType,
    newD2D: typeof EMPTY_D2D, newRetail: typeof EMPTY_RETAIL,
    zip: string, chain: string, addr: string,
  ) => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      doSave(d, ct, newD2D, newRetail, zip, chain, addr);
    }, 800);
  }, [doSave]);

  const setMetrics = campaignType === 'D2D'
    ? (k: string, v: number) => {
        const next = { ...d2d, [k]: v };
        setD2d(next);
        scheduleAutoSave(date, campaignType, next, retail, zipCode, storeChain, storeAddress);
      }
    : (k: string, v: number) => {
        const next = { ...retail, [k]: v };
        setRetail(next);
        scheduleAutoSave(date, campaignType, d2d, next, zipCode, storeChain, storeAddress);
      };

  const effRate = (() => {
    if (campaignType === 'Retail') return retail.zipcodes > 0 ? ((retail.sales / retail.zipcodes) * 100).toFixed(1) : '0.0';
    return d2d.contacts > 0 ? ((d2d.sales / d2d.contacts) * 100).toFixed(1) : '0.0';
  })();
  const effLabel = campaignType === 'Retail' ? t('activity.effZipcodes') : t('activity.effContacts');

  return (
    <AppLayout session={session}>
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
        {/* Greeting */}
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
          {t('activity.greeting')}, {dbUserName || session.user.name}
        </h1>

        {/* Today summary strip */}
        {todayEntry && (
          <div className="mb-4 rounded-2xl px-4 py-3 flex flex-wrap gap-4 items-center text-sm"
            style={{ backgroundColor: 'var(--dark)', color: 'white' }}>
            <span className="font-semibold opacity-70 text-xs uppercase tracking-wide">{t('activity.todayLabel')}</span>
            <span>🕐 {t('activity.firstActivity')}: <strong>{fmtTime(todayEntry.first_activity_at, lang)}</strong></span>
            <span>🕐 {t('activity.lastActivity')}: <strong>{fmtTime(todayEntry.last_activity_at, lang)}</strong></span>
            <span>{t('activity.typeLabel')}: <strong>{todayEntry.campaign_type}</strong></span>
          </div>
        )}

        <div className="grid md:grid-cols-5 gap-5">
          {/* ── Form ── */}
          <div className="md:col-span-2">
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-3 sm:p-5">
              {/* Date */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">{t('activity.date')}</label>
                <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm" />
              </div>

              {/* Campaign type selector — only rendered when more than one
                  modality is allowed today (i.e. profile=both AND no active
                  assignment). Otherwise the disallowed modality must be
                  completely hidden, never just disabled. */}
              {showCampaignSelector && (
                <div className="mb-4">
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide flex items-center gap-1.5">
                    {t('activity.campaignType')}
                    <InfoTooltip text={t('activity.campaignTypeTooltip')} />
                  </label>
                  {todayEntry && date === today() && (
                    <div className="mb-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-[11px] leading-snug text-amber-800 dark:text-amber-200 flex items-start gap-1.5">
                      <span aria-hidden>🔒</span>
                      <span>
                        {t('activity.campaignLockedBannerPrefix')}{' '}
                        <strong>{todayEntry.campaign_type}</strong>{' '}
                        {t('activity.campaignLockedBannerSuffix')}
                      </span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    {allowedModalities.map((ct) => {
                      const lockedByEntry = todayEntry && date === today() && todayEntry.campaign_type !== ct;
                      const isActive = campaignType === ct;
                      const ctColor = ct === 'D2D' ? '#0284c7' : '#9333ea';
                      return (
                        <button key={ct} type="button"
                          disabled={!!lockedByEntry}
                          onClick={() => setCampaignType(ct)}
                          title={lockedByEntry ? t('activity.campaignLocked') : undefined}
                          className={`relative py-2 rounded-xl text-sm font-semibold border transition-colors disabled:cursor-not-allowed ${lockedByEntry ? 'opacity-50 bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border-dashed border-gray-300 dark:border-gray-600' : isActive ? 'text-white border-transparent' : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700'}`}
                          style={isActive && !lockedByEntry ? { backgroundColor: ctColor } : {}}>
                          {lockedByEntry && <span className="absolute top-1 right-1.5 text-[10px]" aria-hidden>🔒</span>}
                          {ct === 'D2D' ? '🚶 D2D' : '🏪 Retail'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Location — gated by formReady so the D2D zip-code field
                   never flashes before we know whether D2D is allowed. */}
              {formReady && campaignType === 'D2D' && (
                <div className="mb-4">
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">{t('activity.zipCode')}</label>
                  <input type="text" value={zipCode} onChange={(e) => setZipCode(e.target.value)}
                    placeholder={t('activity.zipCodePlaceholder')} maxLength={10}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm placeholder-gray-400" />
                </div>
              )}
              {campaignType === 'Retail' && (
                <div className="mb-4">
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">{t('activity.assignedStore')}</label>
                  {assignmentLoading ? (
                    <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                      <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                      {t('common.loading')}
                    </div>
                  ) : assignmentForDate && (assignmentForDate.status === 'accepted' || assignmentForDate.status === 'in_progress' || assignmentForDate.status === 'completed' || assignmentForDate.status === 'incomplete') ? (
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                      <span className="text-sm">📍</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{assignmentForDate.store_name}</p>
                        {assignmentForDate.store_address && <p className="text-[10px] text-gray-400 truncate">{assignmentForDate.store_address}</p>}
                      </div>
                    </div>
                  ) : assignmentForDate?.status === 'pending' ? (
                    <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-3">
                      <p className="text-xs font-semibold text-amber-800 dark:text-amber-200 mb-1">⏳ {t('activity.assignmentPendingTitle')}</p>
                      <p className="text-[11px] text-amber-700 dark:text-amber-300">{t('activity.assignmentPendingBody')}</p>
                      <Link href="/home" className="inline-block mt-1.5 text-[11px] font-bold underline" style={{ color: 'var(--primary)' }}>
                        {t('activity.assignmentPendingCta')} →
                      </Link>
                    </div>
                  ) : assignmentForDate?.status === 'rejected' ? (
                    <div className="rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 px-3 py-3">
                      <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">⏸️ {t('activity.assignmentRejectedTitle')}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('activity.assignmentRejectedBody')}</p>
                    </div>
                  ) : (
                    <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-3">
                      <p className="text-xs font-semibold text-amber-800 dark:text-amber-200 mb-1">📭 {t('activity.assignmentMissingTitle')}</p>
                      <p className="text-[11px] text-amber-700 dark:text-amber-300">{t('activity.assignmentMissingBody')}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Metric fields with +/- — gated by formReady AND only when
                  the current campaignType is in the allowed set, so D2D
                  metric inputs never flash when D2D isn't allowed today. */}
              {formReady && allowedModalities.includes(campaignType) && (
              <div className="space-y-3">
                {fields.map((f) => {
                  const val = (metrics as Record<string, number>)[f.key] ?? 0;
                  const isIncPlus = incrementing === `${f.key}1`;
                  const isIncMinus = incrementing === `${f.key}-1`;
                  return (
                    <div key={f.key} className="rounded-xl border border-gray-100 dark:border-gray-800 p-2 sm:p-3">
                      <div className="flex items-center justify-between mb-1">
                        <div>
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{f.icon} {t(f.labelKey)}</p>
                          <p className="text-[10px] text-gray-400">{t(f.subKey)}{f.goal ? ` — meta: ${f.goal}` : ''}</p>
                        </div>
                        {f.goal && (
                          <div className="text-right">
                            <p className="text-[10px] text-gray-400">{Math.min(100, Math.round((val / f.goal) * 100))}%</p>
                            <div className="w-12 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mt-0.5">
                              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, (val / f.goal) * 100)}%`, backgroundColor: 'var(--primary)' }} />
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" disabled={isPreviewMode || isIncMinus || val === 0 || retailBlocked}
                          onClick={() => handleIncrement(f.key, -1)}
                          className="w-11 h-11 md:w-12 md:h-12 rounded-xl font-bold text-lg md:text-xl flex items-center justify-center border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-red-50 hover:text-red-500 active:scale-95 disabled:opacity-30 transition-all flex-shrink-0">
                          {isIncMinus ? '…' : '−'}
                        </button>
                        <input type="number" min={0} max={999} value={val} readOnly={isPreviewMode}
                          onChange={(e) => setMetrics(f.key, Math.max(0, Number(e.target.value)))}
                          className="flex-1 text-center px-2 py-2.5 md:py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-bold text-xl md:text-2xl focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />
                        <button type="button" disabled={isPreviewMode || isIncPlus || retailBlocked}
                          onClick={() => handleIncrement(f.key, 1)}
                          className="w-11 h-11 md:w-12 md:h-12 rounded-xl font-bold text-lg md:text-xl flex items-center justify-center text-white active:scale-95 disabled:opacity-50 transition-all flex-shrink-0"
                          style={{ backgroundColor: 'var(--primary)' }}>
                          {isIncPlus ? '…' : '+'}
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Effectiveness */}
                <div className="pt-2 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                  <span className="text-xs text-gray-500 flex items-center gap-1.5">
                    {effLabel}
                    <InfoTooltip text={t('activity.effectivenessTooltip')} />
                  </span>
                  <div className={`text-2xl font-extrabold ${parseFloat(effRate) >= 20 ? 'text-green-600' : parseFloat(effRate) >= 10 ? 'text-orange-500' : 'text-gray-400'}`}>
                    {effRate}%
                  </div>
                </div>

                {saving && (
                  <div className="text-center text-xs text-gray-400 py-1">{t('activity.savingText')}</div>
                )}
                {success && (
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 text-green-700 dark:text-green-400 rounded-xl px-4 py-2.5 text-sm font-medium text-center">
                    ✓ {t('activity.success')}
                  </div>
                )}
                {saveError && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 text-red-700 dark:text-red-400 rounded-xl px-4 py-2.5 text-sm font-medium text-center">
                    ⚠ {saveError}
                  </div>
                )}
              </div>
              )}

              {!formReady && (
                <div className="py-8 text-center text-xs text-gray-400">{t('common.loading')}</div>
              )}
            </div>
          </div>

          {/* ── History ── */}
          <div className="md:col-span-3">
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-50 dark:border-gray-800">
                <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">{t('activity.history')}</h3>
              </div>

              {loading ? (
                <div className="p-8 text-center text-gray-400 text-sm">{t('activity.loadingText')}</div>
              ) : history.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">{t('activity.noHistory')}</div>
              ) : (
                <div className="divide-y divide-gray-50 dark:divide-gray-800 max-h-[600px] overflow-y-auto">
                  {history.map((entry) => {
                    const eff = effectivenessRate(entry);
                    const isD2D = entry.campaign_type === 'D2D';
                    const primaryA = isD2D ? entry.knocks : entry.stops;
                    const primaryB = isD2D ? entry.contacts : entry.zipcodes;
                    const primaryC = isD2D ? entry.bills : entry.credit_checks;
                    const labelA = isD2D ? 'Knocks' : 'Stops';
                    const labelB = isD2D ? t('notifications.contacts') : 'Zipcodes';
                    const labelC = isD2D ? 'Bills' : 'Credit';
                    return (
                      <div key={entry.id} className="px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{fmtDate(entry.date, lang)}</p>
                              <span className="text-xs px-1.5 py-0.5 rounded font-medium text-white" style={{ backgroundColor: isD2D ? '#0284c7' : '#9333ea' }}>
                                {isD2D ? 'D2D' : 'RTL'}
                              </span>
                              {entry.zip_code && <span className="text-xs text-gray-400">{entry.zip_code}</span>}
                              {entry.store_chain && <span className="text-xs text-gray-400">{entry.store_chain}</span>}
                            </div>
                            {/* Times */}
                            {(entry.first_activity_at || entry.last_activity_at) && (
                              <p className="text-[10px] text-gray-400 mb-1.5">
                                🕐 {fmtTime(entry.first_activity_at, lang)} → {fmtTime(entry.last_activity_at, lang)}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
                              <span>{labelA}: <strong className="text-gray-800 dark:text-gray-200">{primaryA}</strong></span>
                              <span>{labelB}: <strong className="text-gray-800 dark:text-gray-200">{primaryB}</strong></span>
                              <span>{labelC}: <strong className="text-gray-800 dark:text-gray-200">{primaryC}</strong></span>
                              <span>{t('notifications.sales')}: <strong style={{ color: 'var(--primary)' }}>{entry.sales}</strong></span>
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${eff >= 25 ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : eff >= 15 ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300' : 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'}`}>
                                {eff.toFixed(1)}%
                              </span>
                            </div>
                          </div>
                          {!isPreviewMode && (
                          <div className="flex gap-1 flex-shrink-0">
                            <button onClick={() => { setDate(entry.date); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                              className="text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors">
                              {t('activity.edit')}
                            </button>
                            <button onClick={() => handleDelete(entry)}
                              className="text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-400 hover:border-red-300 hover:text-red-500 transition-colors">
                              {t('activity.delete')}
                            </button>
                          </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Sticky bottom save CTA — mobile only, today's date, not preview */}
      {date === today() && !isPreviewMode && (
        <div className="fixed bottom-0 left-0 right-0 z-40 md:hidden px-4 py-3 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border-t border-gray-100 dark:border-gray-800">
          <button
            type="button"
            onClick={() => doSave(date, campaignType, d2d, retail, zipCode, storeChain, storeAddress)}
            disabled={saving}
            className="w-full py-3.5 rounded-xl font-bold text-white text-sm transition-opacity disabled:opacity-60 active:scale-95"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            {saving ? t('home.savingSticky') : success ? t('home.savedSticky') : t('home.saveCTA')}
          </button>
        </div>
      )}
    </AppLayout>
  );
}
