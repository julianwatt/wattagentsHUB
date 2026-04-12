'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Session } from 'next-auth';
import AppLayout from './AppLayout';
import { useLanguage } from './LanguageContext';
import { fmtDate } from '@/lib/i18n';
import { ActivityEntry, CampaignType, effectivenessRate } from '@/lib/activity';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
);

const today = () => new Date().toISOString().split('T')[0];

const STORE_CHAINS = ['Walmart', 'HEB', "Sam's Club", 'El Rancho Supermercado', 'La Michoacana', 'Fiesta Mart', 'Otro'];

type D2DKey = 'knocks' | 'contacts' | 'bills' | 'sales';
type RetailKey = 'stops' | 'zipcodes' | 'credit_checks' | 'sales';

const D2D_FIELDS: Array<{ key: D2DKey; goal?: number; label: string; sub: string }> = [
  { key: 'knocks',   goal: 100, label: '🚪 Knocks',        sub: 'Puertas tocadas' },
  { key: 'contacts', goal: 30,  label: '🤝 Contactos',     sub: 'Prospectos contactados' },
  { key: 'bills',    goal: undefined, label: '📄 Billes',  sub: 'Recibos solicitados' },
  { key: 'sales',    goal: undefined, label: '✅ Ventas',   sub: 'Ventas cerradas' },
];

const RETAIL_FIELDS: Array<{ key: RetailKey; goal?: number; label: string; sub: string }> = [
  { key: 'stops',         goal: 100, label: '🛒 Stops',         sub: 'Paradas de cliente' },
  { key: 'zipcodes',      goal: 30,  label: '📍 Zipcodes',      sub: 'Zipcodes pedidos' },
  { key: 'credit_checks', goal: undefined, label: '💳 Credit Check', sub: 'Revisiones de crédito' },
  { key: 'sales',         goal: undefined, label: '✅ Ventas',        sub: 'Ventas cerradas' },
];

const EMPTY_D2D = { knocks: 0, contacts: 0, bills: 0, sales: 0 };
const EMPTY_RETAIL = { stops: 0, zipcodes: 0, credit_checks: 0, sales: 0 };

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

export default function ActivityClient({ session }: { session: Session }) {
  const { t, lang } = useLanguage();
  // If admin visits /activity without preview mode, redirect to /admin
  const isRealAdmin = session.user.role === 'admin';
  // Check localStorage for preview role (same key as PreviewRoleContext)
  const [adminAllowed, setAdminAllowed] = useState(!isRealAdmin);
  useEffect(() => {
    if (!isRealAdmin) return;
    try {
      const saved = localStorage.getItem('wattPreviewRole');
      if (saved) setAdminAllowed(true);
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

  const loadEntry = useCallback(async (d: string) => {
    const res = await fetch(`/api/activity?agentId=${session.user.id}&date=${d}`);
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
  }, [session.user.id]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/activity');
    if (res.ok) {
      const data: ActivityEntry[] = await res.json();
      setHistory(data);
      const te = data.find((e) => e.date === today());
      if (te) { setTodayEntry(te); applyEntry(te); }
    }
    setLoading(false);
  }, []);

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

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('activity-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'activity_entries',
        filter: `agent_id=eq.${session.user.id}`,
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
    return () => { supabase.removeChannel(channel); };
  }, [session.user.id, date]);

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
  const effLabel = campaignType === 'Retail' ? 'Zipcodes → Ventas' : 'Contactos → Ventas';

  return (
    <AppLayout session={session}>
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
        {/* Today summary strip */}
        {todayEntry && (
          <div className="mb-4 rounded-2xl px-4 py-3 flex flex-wrap gap-4 items-center text-sm"
            style={{ backgroundColor: 'var(--dark)', color: 'white' }}>
            <span className="font-semibold opacity-70 text-xs uppercase tracking-wide">Hoy</span>
            <span>🕐 Primera actividad: <strong>{fmtTime(todayEntry.first_activity_at)}</strong></span>
            <span>🕐 Última actividad: <strong>{fmtTime(todayEntry.last_activity_at)}</strong></span>
            <span>Tipo: <strong>{todayEntry.campaign_type}</strong></span>
          </div>
        )}

        <div className="grid lg:grid-cols-5 gap-5">
          {/* ── Form ── */}
          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-3 sm:p-5">
              {/* Date */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">{t('activity.date')}</label>
                <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm" />
              </div>

              {/* Campaign type */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">{t('activity.campaignType')}</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['D2D', 'Retail'] as CampaignType[]).map((ct) => {
                    // Lock the other tab if today already has an entry of one type
                    const lockedByEntry = todayEntry && date === today() && todayEntry.campaign_type !== ct;
                    const isActive = campaignType === ct;
                    const ctColor = ct === 'D2D' ? '#0284c7' : '#9333ea'; // sky / purple
                    return (
                      <button key={ct} type="button"
                        disabled={!!lockedByEntry}
                        onClick={() => setCampaignType(ct)}
                        title={lockedByEntry ? t('activity.campaignLocked') : undefined}
                        className={`py-2 rounded-xl text-sm font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isActive ? 'text-white border-transparent' : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700'}`}
                        style={isActive ? { backgroundColor: ctColor } : {}}>
                        {ct === 'D2D' ? '🚶 D2D' : '🏪 Retail'}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Location */}
              {campaignType === 'D2D' && (
                <div className="mb-4">
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">{t('activity.zipCode')}</label>
                  <input type="text" value={zipCode} onChange={(e) => setZipCode(e.target.value)}
                    placeholder={t('activity.zipCodePlaceholder')} maxLength={10}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm placeholder-gray-400" />
                </div>
              )}
              {campaignType === 'Retail' && (
                <div className="mb-4 space-y-2">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1 uppercase tracking-wide">{t('activity.storeChain')}</label>
                    <select value={storeChain} onChange={(e) => setStoreChain(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm">
                      {STORE_CHAINS.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1 uppercase tracking-wide">{t('activity.storeAddress')}</label>
                    <input type="text" value={storeAddress} onChange={(e) => setStoreAddress(e.target.value)}
                      placeholder={t('activity.storeAddressPlaceholder')}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm placeholder-gray-400" />
                  </div>
                </div>
              )}

              {/* Metric fields with +/- */}
              <div className="space-y-3">
                {fields.map((f) => {
                  const val = (metrics as Record<string, number>)[f.key] ?? 0;
                  const isIncPlus = incrementing === `${f.key}1`;
                  const isIncMinus = incrementing === `${f.key}-1`;
                  return (
                    <div key={f.key} className="rounded-xl border border-gray-100 dark:border-gray-800 p-2 sm:p-3">
                      <div className="flex items-center justify-between mb-1">
                        <div>
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{f.label}</p>
                          <p className="text-[10px] text-gray-400">{f.sub}{f.goal ? ` — meta: ${f.goal}` : ''}</p>
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
                        <button type="button" disabled={isIncMinus || val === 0}
                          onClick={() => handleIncrement(f.key, -1)}
                          className="w-9 h-9 rounded-xl font-bold text-lg flex items-center justify-center border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-red-50 hover:text-red-500 disabled:opacity-30 transition-colors flex-shrink-0">
                          {isIncMinus ? '…' : '−'}
                        </button>
                        <input type="number" min={0} max={999} value={val}
                          onChange={(e) => setMetrics(f.key, Math.max(0, Number(e.target.value)))}
                          className="flex-1 text-center px-2 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-bold text-xl focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />
                        <button type="button" disabled={isIncPlus}
                          onClick={() => handleIncrement(f.key, 1)}
                          className="w-9 h-9 rounded-xl font-bold text-lg flex items-center justify-center text-white disabled:opacity-50 transition-colors flex-shrink-0"
                          style={{ backgroundColor: 'var(--primary)' }}>
                          {isIncPlus ? '…' : '+'}
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Effectiveness */}
                <div className="pt-2 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                  <p className="text-xs text-gray-500">{effLabel}</p>
                  <div className={`text-2xl font-extrabold ${parseFloat(effRate) >= 20 ? 'text-green-600' : parseFloat(effRate) >= 10 ? 'text-orange-500' : 'text-gray-400'}`}>
                    {effRate}%
                  </div>
                </div>

                {saving && (
                  <div className="text-center text-xs text-gray-400 py-1">Guardando...</div>
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
            </div>
          </div>

          {/* ── History ── */}
          <div className="lg:col-span-3">
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-50 dark:border-gray-800">
                <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">{t('activity.history')}</h3>
              </div>

              {loading ? (
                <div className="p-8 text-center text-gray-400 text-sm">Cargando...</div>
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
                    const labelB = isD2D ? 'Contactos' : 'Zipcodes';
                    const labelC = isD2D ? 'Billes' : 'Credit';
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
                                🕐 {fmtTime(entry.first_activity_at)} → {fmtTime(entry.last_activity_at)}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
                              <span>{labelA}: <strong className="text-gray-800 dark:text-gray-200">{primaryA}</strong></span>
                              <span>{labelB}: <strong className="text-gray-800 dark:text-gray-200">{primaryB}</strong></span>
                              <span>{labelC}: <strong className="text-gray-800 dark:text-gray-200">{primaryC}</strong></span>
                              <span>Ventas: <strong style={{ color: 'var(--primary)' }}>{entry.sales}</strong></span>
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${eff >= 25 ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : eff >= 15 ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300' : 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'}`}>
                                {eff.toFixed(1)}%
                              </span>
                            </div>
                          </div>
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
    </AppLayout>
  );
}
