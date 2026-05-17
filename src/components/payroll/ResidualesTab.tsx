'use client';
import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/components/LanguageContext';
import { residualTypeLabel } from '@/lib/payroll/labels';
import { RESIDUAL_TYPES, type ResidualType } from '@/lib/payroll/constants';

/**
 * Block 10 — Residuales tab.
 *
 * Read-only listing of residuals captured by the parser, with filters,
 * totals, CSV export, and inline notes-only editing.
 */

interface ResidualRow {
  id: string;
  residual_type: ResidualType;
  amount: number;
  pay_week: string;
  notes: string | null;
  created_at: string;
  contract_id: string | null;
  customer_name: string | null;
  plan_name: string | null;
  agent_id: string | null;
  agent_name: string | null;
}

interface FetchResult {
  rows: ResidualRow[];
  totals_by_type: Record<string, { count: number; amount: number }>;
  grand_total: number;
  row_count: number;
}

export default function ResidualesTab() {
  const { t, lang } = useLanguage();
  const [data, setData] = useState<FetchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ResidualRow | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const url = new URL('/api/payroll/residuals', window.location.origin);
    if (typeFilter) url.searchParams.set('residual_type', typeFilter);
    if (from) url.searchParams.set('from', from);
    if (to) url.searchParams.set('to', to);
    if (search) url.searchParams.set('search', search);
    const r = await fetch(url.pathname + url.search);
    if (r.ok) setData(await r.json());
    setLoading(false);
  }, [typeFilter, from, to, search]);

  useEffect(() => { refresh(); }, [refresh]);

  function handleExport() {
    const url = new URL('/api/payroll/residuals', window.location.origin);
    if (typeFilter) url.searchParams.set('residual_type', typeFilter);
    if (from) url.searchParams.set('from', from);
    if (to) url.searchParams.set('to', to);
    if (search) url.searchParams.set('search', search);
    url.searchParams.set('export', 'csv');
    window.open(url.pathname + url.search, '_blank');
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-3 sm:p-4">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">{t('common.search')}</label>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={t('payroll.residuales.searchPlaceholder')}
              className="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">{t('payroll.residuales.typeFilter')}</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs">
              <option value="">{lang === 'es' ? 'Todos' : 'All'}</option>
              {RESIDUAL_TYPES.map((rt) => (<option key={rt} value={rt}>{residualTypeLabel(rt, lang)}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">{t('payroll.residuales.from')}</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">{t('payroll.residuales.to')}</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs" />
          </div>
          <button onClick={handleExport} className="ml-auto px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-xs">
            {t('payroll.residuales.exportCsv')}
          </button>
        </div>
      </div>

      {/* Totals tiles */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Tile label={t('payroll.residuales.grandTotal')} amount={data.grand_total} count={data.row_count} accent="violet" />
          {Object.entries(data.totals_by_type).map(([type, t2]) => (
            <Tile key={type} label={residualTypeLabel(type as ResidualType, lang)} amount={t2.amount} count={t2.count} accent={type === 'GREEN_BONUS' ? 'lime' : 'purple'} />
          ))}
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-3 sm:px-5 py-3 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">{t('payroll.residuales.listTitle')}</h3>
          <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full px-2.5 py-0.5 font-semibold">{data?.row_count ?? 0}</span>
        </div>
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('common.loading')}</div>
        ) : !data || data.rows.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('common.noData')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2 text-left">{t('payroll.residuales.colType')}</th>
                  <th className="px-3 py-2 text-left">{t('payroll.residuales.colContract')}</th>
                  <th className="px-3 py-2 text-left">{t('payroll.residuales.colCustomer')}</th>
                  <th className="px-3 py-2 text-left">{t('payroll.residuales.colAgent')}</th>
                  <th className="px-3 py-2 text-left">{t('payroll.residuales.colPlan')}</th>
                  <th className="px-3 py-2 text-left">{t('payroll.residuales.colWeek')}</th>
                  <th className="px-3 py-2 text-right">{t('payroll.residuales.colAmount')}</th>
                  <th className="px-3 py-2 text-left">{t('payroll.residuales.colNotes')}</th>
                  <th className="px-3 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {data.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                    <td className="px-3 py-2">
                      <span className="inline-block bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 px-2 py-0.5 rounded-full text-[10px] font-bold">
                        {residualTypeLabel(r.residual_type, lang)}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-gray-700 dark:text-gray-200">{r.contract_id ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-200">{r.customer_name ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-200">{r.agent_name ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300 max-w-[280px] truncate" title={r.plan_name ?? ''}>{r.plan_name ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 font-mono text-[10px]">{r.pay_week}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700 dark:text-gray-200">${r.amount.toFixed(2)}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 max-w-[180px] truncate" title={r.notes ?? ''}>{r.notes ?? '—'}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => setEditing(r)} className="text-[var(--primary)] hover:underline">{t('common.edit')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <NotesModal residual={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />
      )}
    </div>
  );
}

function NotesModal({ residual, onClose, onSaved }: { residual: ResidualRow; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage();
  const [notes, setNotes] = useState(residual.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true); setError('');
    const r = await fetch(`/api/payroll/residuals/${residual.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error || t('common.error'));
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white dark:bg-gray-900 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h4 className="font-bold text-gray-800 dark:text-gray-100">{t('payroll.residuales.editNotesTitle')}</h4>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="rounded-xl bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs">
            <p className="font-mono">{residual.contract_id ?? '—'} · {residual.plan_name ?? '—'}</p>
            <p className="font-mono">${residual.amount.toFixed(2)} · PW {residual.pay_week}</p>
          </div>
          <textarea
            value={notes} onChange={(e) => setNotes(e.target.value)} rows={4}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            placeholder={t('payroll.residuales.notesPlaceholder')}
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-sm">{t('common.cancel')}</button>
            <button onClick={save} disabled={busy} className="flex-1 py-2.5 rounded-xl text-white font-bold text-sm disabled:opacity-50" style={{ backgroundColor: 'var(--primary)' }}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, amount, count, accent }: { label: string; amount: number; count: number; accent: string }) {
  const colors: Record<string, string> = {
    violet: 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800',
    lime:   'bg-lime-50 dark:bg-lime-900/20 text-lime-700 dark:text-lime-300 border-lime-200 dark:border-lime-800',
  };
  return (
    <div className={`rounded-xl border px-3 py-2 ${colors[accent] ?? colors.violet}`}>
      <p className="text-lg font-extrabold leading-tight font-mono">${amount.toFixed(2)}</p>
      <p className="text-[10px] uppercase tracking-wide opacity-80 mt-0.5">{label} · {count}</p>
    </div>
  );
}
