'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Session } from 'next-auth';
import AppLayout from '@/components/AppLayout';
import { useLanguage } from '@/components/LanguageContext';
import { payfileLineTypeLabel } from '@/lib/payroll/labels';
import type { PayfileLineItem, Payfile } from '@/types/payroll';
import type { PayfileLineType } from '@/lib/payroll/constants';

/**
 * Block 12 — Mis Pagos client.
 *
 * Three sub-tabs:
 *   - Actual   : latest PUBLISHED payfile, with category breakdown +
 *                sales detail
 *   - Histórico: list of every published payfile, click → same detail
 *   - Resumen  : month + year aggregates
 *
 * Privacy: the API enforces it (managers don't see other managers'
 * overrides). The UI just renders whatever bundle comes back.
 *
 * Mobile-first: every table renders as cards under sm, full table at sm+.
 */

interface SaleDetail {
  id: string;
  contract_id: string;
  customer_name: string | null;
  plan_name: string;
  contract_signed_date: string | null;
  is_winback: boolean;
  internal_agent_id: string | null;
  agent_name?: string | null;
}

interface PayfileBundle {
  payfile: Payfile;
  line_items: PayfileLineItem[];
  overrides: Array<{ id: string; sale_id: string; manager_level: string; amount: number; payfile_line_item_id: string | null }>;
  sales_detail: SaleDetail[];
  in_progress: false;
}

interface InProgressResponse {
  payfile_id: string;
  pay_week: string;
  state: string;
  in_progress: true;
}

interface CurrentResponse {
  has_published: boolean;
  payfile?: Payfile;
  pending_state?: string | null;
  pending_week?: string | null;
}

interface HistoryRow extends Payfile {
  line_count: number;
  was_updated: boolean;
}

interface SummaryResponse {
  month: { start: string; total: number; payfile_count: number; payables: number; chargebacks: number; avg_per_week: number };
  year: { start: string; total: number; payables: number; chargebacks: number; monthly_buckets: number[] };
}

type SubTab = 'current' | 'history' | 'summary';

export default function MyPayClient({ session }: { session: Session }) {
  const { t, lang } = useLanguage();
  const [tab, setTab] = useState<SubTab>('current');
  const [currentResp, setCurrentResp] = useState<CurrentResponse | null>(null);
  const [activePayfileId, setActivePayfileId] = useState<string | null>(null);
  const [bundle, setBundle] = useState<PayfileBundle | InProgressResponse | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  // Initial: fetch "current" + history.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [curRes, histRes] = await Promise.all([
        fetch('/api/payroll/my-pay/current'),
        fetch('/api/payroll/my-pay/history'),
      ]);
      if (cancelled) return;
      if (curRes.ok) {
        const j: CurrentResponse = await curRes.json();
        setCurrentResp(j);
        if (j.has_published && j.payfile) setActivePayfileId(j.payfile.id);
      }
      if (histRes.ok) setHistory((await histRes.json()).rows ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch bundle whenever the active payfile changes.
  const fetchBundle = useCallback(async (payfileId: string) => {
    const r = await fetch(`/api/payroll/my-pay/week?payfile_id=${encodeURIComponent(payfileId)}`);
    if (!r.ok) { setBundle(null); return; }
    const j = await r.json();
    setBundle(j as PayfileBundle | InProgressResponse);
  }, []);
  useEffect(() => { if (activePayfileId) fetchBundle(activePayfileId); }, [activePayfileId, fetchBundle]);

  // Lazy-load summary on first visit.
  useEffect(() => {
    if (tab !== 'summary' || summary) return;
    (async () => {
      const r = await fetch('/api/payroll/my-pay/summary');
      if (r.ok) setSummary(await r.json());
    })();
  }, [tab, summary]);

  async function downloadPdf() {
    if (!activePayfileId) return;
    setDownloading(true);
    const r = await fetch(`/api/payroll/payfiles/${activePayfileId}/download`);
    setDownloading(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.error || t('common.error'));
      return;
    }
    const j = await r.json();
    window.open(j.url, '_blank', 'noopener');
  }

  return (
    <AppLayout session={session}>
      <div className="max-w-3xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-4 overflow-x-hidden">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{t('myPay.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {t('myPay.greetingPrefix')} {session.user.name?.split(' ')[0]}
          </p>
        </div>

        {/* Sub-tabs */}
        <div className="inline-flex rounded-xl border border-gray-200 dark:border-gray-700 p-0.5 bg-gray-50 dark:bg-gray-800">
          {(['current', 'history', 'summary'] as SubTab[]).map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                tab === id
                  ? 'bg-white dark:bg-gray-900 text-[var(--primary)] shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {t(`myPay.tab_${id}`)}
            </button>
          ))}
        </div>

        {tab === 'current' && (
          <CurrentView
            loading={loading}
            currentResp={currentResp}
            bundle={bundle}
            onDownload={downloadPdf}
            downloading={downloading}
            history={history}
            activePayfileId={activePayfileId}
            onSelectPayfile={setActivePayfileId}
            t={t}
            lang={lang}
          />
        )}
        {tab === 'history' && (
          <HistoryView
            history={history}
            onOpen={(id) => { setActivePayfileId(id); setTab('current'); }}
            t={t}
            lang={lang}
          />
        )}
        {tab === 'summary' && <SummaryView summary={summary} t={t} lang={lang} />}
      </div>
    </AppLayout>
  );
}

// ── Current view ────────────────────────────────────────────────────────────

function CurrentView({
  loading, currentResp, bundle, onDownload, downloading, history, activePayfileId, onSelectPayfile, t, lang,
}: {
  loading: boolean;
  currentResp: CurrentResponse | null;
  bundle: PayfileBundle | InProgressResponse | null;
  onDownload: () => void;
  downloading: boolean;
  history: HistoryRow[];
  activePayfileId: string | null;
  onSelectPayfile: (id: string) => void;
  t: (k: string) => string;
  lang: 'es' | 'en';
}) {
  if (loading) {
    return <div className="text-center py-16 text-gray-400 text-sm">{t('common.loading')}</div>;
  }

  // No published payfile + no draft in flight.
  if (currentResp && !currentResp.has_published && !currentResp.pending_state) {
    return (
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-6 text-center text-gray-600 dark:text-gray-300 text-sm">
        {t('myPay.noPublishedYet')}
      </div>
    );
  }

  // Bundle came back as in-progress for the active week.
  if (bundle && 'in_progress' in bundle && bundle.in_progress) {
    return (
      <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-6 text-center text-amber-800 dark:text-amber-200 text-sm">
        {t('myPay.inProgressNote')}
      </div>
    );
  }

  // Pending state, no published payfile yet.
  if (currentResp && !currentResp.has_published && currentResp.pending_state) {
    return (
      <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-6 text-center text-amber-800 dark:text-amber-200 text-sm">
        {t('myPay.pendingByAdmin')}
      </div>
    );
  }

  if (!bundle || !('payfile' in bundle) || ('in_progress' in bundle && bundle.in_progress)) return null;
  const b = bundle as PayfileBundle;

  // Week selector — list every published payfile + the current one.
  const allWeeks = Array.from(
    new Map(
      [...history.map((h) => [h.id, { id: h.id, pay_week: h.pay_week, was_updated: h.was_updated }] as const)]
    ).values(),
  );

  // Category buckets.
  const buckets: Record<string, PayfileLineItem[]> = {
    COMMISSION: [], OVERRIDE: [], COMPANY_BONUS: [], COLLECTION_INCOME: [],
    NEGATIVE_BALANCE_COLLECTION: [], COLLECTION: [], MANUAL_ADJUSTMENT: [],
  };
  for (const li of b.line_items) (buckets[li.line_type] ??= []).push(li);

  const categoryOrder: { key: PayfileLineType; titleKey: string }[] = [
    { key: 'COMMISSION', titleKey: 'myPay.catCommission' },
    { key: 'OVERRIDE', titleKey: 'myPay.catOverride' },
    { key: 'COMPANY_BONUS', titleKey: 'myPay.catBonus' },
    { key: 'COLLECTION_INCOME', titleKey: 'myPay.catCollectionIncome' },
    { key: 'NEGATIVE_BALANCE_COLLECTION', titleKey: 'myPay.catNegativeBalance' },
    { key: 'COLLECTION', titleKey: 'myPay.catCollection' },
    { key: 'MANUAL_ADJUSTMENT', titleKey: 'myPay.catManual' },
  ];

  return (
    <div className="space-y-4">
      {/* Week selector */}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">
            {t('myPay.weekSelector')}
          </label>
          <select
            value={activePayfileId ?? ''}
            onChange={(e) => onSelectPayfile(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
          >
            {allWeeks.map((w) => (
              <option key={w.id} value={w.id}>{w.pay_week}{w.was_updated ? ' · ' + t('myPay.updatedBadge') : ''}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary card */}
      <div className="rounded-2xl bg-gradient-to-br from-[var(--primary)]/10 to-transparent border border-gray-100 dark:border-gray-800 p-4 sm:p-5">
        <p className="text-[10px] uppercase tracking-wide font-bold text-gray-500 dark:text-gray-400">
          {t('myPay.totalLabel')} · {b.payfile.pay_week}
        </p>
        <div className="flex items-center justify-between gap-3 mt-1">
          <p className="text-3xl sm:text-4xl font-extrabold text-gray-900 dark:text-gray-100 font-mono">
            ${Number(b.payfile.total_amount).toFixed(2)}
          </p>
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={onDownload}
              disabled={downloading}
              className="px-3 py-1.5 rounded-xl text-white font-semibold text-xs disabled:opacity-60"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              {downloading ? t('common.loading') : `↓ ${t('myPay.downloadPdf')}`}
            </button>
            {b.payfile.last_version_number > 1 && (
              <span className="inline-block bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded text-[9px] font-bold">
                {t('myPay.updatedBadge')} v{b.payfile.last_version_number}
              </span>
            )}
          </div>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          {b.line_items.length} {t('myPay.linesShort')}
          {b.payfile.had_negative_balance && (
            <span className="ml-2 text-rose-600 dark:text-rose-400 font-semibold">{t('myPay.hadNegativeBalance')}</span>
          )}
        </p>
        {Number(b.payfile.total_amount) === 0 && !b.payfile.had_negative_balance && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 italic">{t('myPay.zeroPay')}</p>
        )}
      </div>

      {/* Categories */}
      {categoryOrder.map(({ key, titleKey }) => {
        const items = buckets[key];
        if (!items || items.length === 0) return null;
        const subtotal = items.reduce((acc, i) => acc + Number(i.amount), 0);
        return (
          <details key={key} open className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            <summary className="cursor-pointer px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/40">
              <span className="text-sm font-bold text-gray-800 dark:text-gray-100">
                {t(titleKey)} <span className="text-gray-400 text-xs">({items.length})</span>
              </span>
              <span className={`font-mono font-bold text-sm ${subtotal < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-900 dark:text-gray-100'}`}>
                ${subtotal.toFixed(2)}
              </span>
            </summary>
            <div className="border-t border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
              {items.map((li) => {
                const sale = li.source_sale_id ? b.sales_detail.find((s) => s.id === li.source_sale_id) : null;
                return (
                  <div key={li.id} className="px-4 py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-gray-700 dark:text-gray-200 truncate" title={li.description}>{li.description}</p>
                      {sale && (
                        <p className="text-[10px] text-gray-400 mt-0.5 font-mono truncate">
                          {sale.contract_id}
                          {sale.is_winback && <span className="ml-1 inline-block bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 px-1 py-0.5 rounded text-[8.5px] font-bold">WB</span>}
                          {key === 'OVERRIDE' && sale.agent_name && ` · ${sale.agent_name}`}
                        </p>
                      )}
                    </div>
                    <p className={`font-mono text-xs whitespace-nowrap ${Number(li.amount) < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-900 dark:text-gray-100'}`}>
                      ${Number(li.amount).toFixed(2)}
                    </p>
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}

      {/* Sales detail */}
      {b.sales_detail.length > 0 && (
        <details className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
          <summary className="cursor-pointer px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 text-sm font-bold text-gray-800 dark:text-gray-100">
            {t('myPay.salesDetailTitle')} <span className="text-gray-400 text-xs">({b.sales_detail.length})</span>
          </summary>
          <div className="border-t border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {b.sales_detail.map((s) => (
              <div key={s.id} className="px-4 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-gray-700 dark:text-gray-200 truncate">{s.contract_id}</span>
                  {s.is_winback && <span className="bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 px-1 py-0.5 rounded text-[9px] font-bold">WB</span>}
                </div>
                <p className="text-gray-600 dark:text-gray-300 truncate" title={s.plan_name}>{s.plan_name}</p>
                <p className="text-[10px] text-gray-400">
                  {s.customer_name ?? '—'} · {s.contract_signed_date ?? '—'}
                </p>
              </div>
            ))}
          </div>
        </details>
      )}

      <p className="text-[10px] text-gray-400 text-center pt-2">
        {t('myPay.lang')} · {lang.toUpperCase()}
      </p>
    </div>
  );
}

// ── History view ────────────────────────────────────────────────────────────

function HistoryView({
  history, onOpen, t, lang,
}: {
  history: HistoryRow[];
  onOpen: (id: string) => void;
  t: (k: string) => string;
  lang: 'es' | 'en';
}) {
  if (history.length === 0) {
    return <div className="text-center py-16 text-gray-400 text-sm">{t('myPay.noHistory')}</div>;
  }
  return (
    <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {history.map((h) => (
          <button
            key={h.id}
            onClick={() => onOpen(h.id)}
            className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 font-mono">{h.pay_week}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">
                {h.line_count} {t('myPay.linesShort')}
                {h.was_updated && <span className="ml-2 inline-block bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded text-[9px] font-bold">{t('myPay.updatedBadge')}</span>}
                {h.had_negative_balance && <span className="ml-2 inline-block bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 px-1.5 py-0.5 rounded text-[9px] font-bold">−</span>}
              </p>
            </div>
            <p className={`font-mono text-sm font-bold ${Number(h.total_amount) < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-900 dark:text-gray-100'}`}>
              ${Number(h.total_amount).toFixed(2)}
            </p>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 text-center py-3">{t('myPay.historyHint')} · {lang.toUpperCase()}</p>
    </div>
  );
}

// ── Summary view ────────────────────────────────────────────────────────────

function SummaryView({ summary, t, lang }: { summary: SummaryResponse | null; t: (k: string) => string; lang: 'es' | 'en' }) {
  if (!summary) {
    return <div className="text-center py-16 text-gray-400 text-sm">{t('common.loading')}</div>;
  }
  const maxBucket = Math.max(...summary.year.monthly_buckets, 1);
  const monthNames = lang === 'es'
    ? ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
    : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <p className="text-[10px] uppercase tracking-wide font-bold text-gray-500 dark:text-gray-400 mb-2">
          {t('myPay.summaryMonth')}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <SummaryTile label={t('myPay.totalLabel')} value={`$${summary.month.total.toFixed(2)}`} accent="emerald" />
          <SummaryTile label={t('myPay.avgPerWeek')} value={`$${summary.month.avg_per_week.toFixed(2)}`} accent="sky" />
          <SummaryTile label={t('myPay.payables')} value={String(summary.month.payables)} accent="indigo" />
          <SummaryTile label={t('myPay.chargebacks')} value={String(summary.month.chargebacks)} accent={summary.month.chargebacks > 0 ? 'rose' : 'gray'} />
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <p className="text-[10px] uppercase tracking-wide font-bold text-gray-500 dark:text-gray-400 mb-2">
          {t('myPay.summaryYear')} · ${summary.year.total.toFixed(2)}
        </p>
        <div className="flex items-end justify-between h-32 gap-1 mt-2">
          {summary.year.monthly_buckets.map((v, i) => {
            const height = Math.max(2, Math.round((v / maxBucket) * 100));
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full bg-[var(--primary)]/30 rounded-sm" style={{ height: `${height}%` }} title={`$${v.toFixed(2)}`} />
                <span className="text-[8px] text-gray-400">{monthNames[i]}</span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400 mt-3">
          <span>{t('myPay.payables')}: {summary.year.payables}</span>
          <span>{t('myPay.chargebacks')}: {summary.year.chargebacks}</span>
        </div>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, accent }: { label: string; value: string; accent: string }) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    sky:     'bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800',
    indigo:  'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
    rose:    'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800',
    gray:    'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700',
  };
  return (
    <div className={`rounded-xl border px-3 py-2 ${colors[accent] ?? colors.gray}`}>
      <p className="text-base font-extrabold leading-tight font-mono">{value}</p>
      <p className="text-[10px] uppercase tracking-wide opacity-80 mt-0.5">{label}</p>
    </div>
  );
}

// Silence unused: kept for potential future use in row badges.
void payfileLineTypeLabel;
