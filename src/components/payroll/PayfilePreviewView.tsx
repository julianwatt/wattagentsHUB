'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/components/LanguageContext';
import { payfileLineTypeLabel, payfileStateLabel } from '@/lib/payroll/labels';
import type { PayfileLineItem, PayfileOverride, Payfile } from '@/types/payroll';
import type { PayfileLineType, PayfileState } from '@/lib/payroll/constants';
import { OVER_RECEIVED_MULTIPLE } from '@/lib/payroll/constants';

/**
 * Block 06 — preview of generated payfiles for a pay_week.
 *
 * Lives as the third sub-tab inside PendientesTab. Shows every user's
 * draft payfile for the selected week, lets admin edit line item amounts
 * (with the 3× guard) and add manual line items.
 */

interface UserSlice { id: string; name: string; role: string | null }
interface PayfileWithItems extends Payfile {
  user: UserSlice | null;
  line_items: PayfileLineItem[];
  overrides: PayfileOverride[];
}
interface FetchResult { pay_week: string; payfiles: PayfileWithItems[] }
interface CalcResult {
  ok: boolean;
  payfiles_generated: number;
  total_line_items: number;
  total_overrides: number;
  negative_balances_created: number;
  errors: { code: string; message: string }[];
}

export default function PayfilePreviewView() {
  const { t, lang } = useLanguage();
  const [weeks, setWeeks] = useState<string[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<string>('');
  const [data, setData] = useState<FetchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [calcRunning, setCalcRunning] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<PayfileLineItem | null>(null);
  const [adding, setAdding] = useState<PayfileWithItems | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetch('/api/payroll/sales?weeks=1');
      if (!r.ok) { if (!cancelled) setLoading(false); return; }
      const ws: string[] = await r.json();
      if (cancelled) return;
      setWeeks(ws);
      if (ws.length > 0 && !selectedWeek) setSelectedWeek(ws[0]);
      else if (ws.length === 0) setLoading(false);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchPayfiles = useCallback(async (week: string) => {
    if (!week) return;
    setLoading(true);
    const r = await fetch(`/api/payroll/payfiles?pay_week=${encodeURIComponent(week)}`);
    if (r.ok) setData(await r.json());
    setLoading(false);
  }, []);
  useEffect(() => { if (selectedWeek) fetchPayfiles(selectedWeek); }, [selectedWeek, fetchPayfiles]);

  async function handleCalculate() {
    if (!selectedWeek) return;
    setCalcRunning(true);
    const r = await fetch(`/api/payroll/payfiles/calculate?pay_week=${encodeURIComponent(selectedWeek)}`, {
      method: 'POST',
    });
    const j = (await r.json()) as CalcResult & { error?: string };
    setCalcRunning(false);
    if (!r.ok && !j.payfiles_generated) {
      alert(j.error ?? j.errors?.map((e) => e.message).join('\n') ?? 'Error en cálculo');
      return;
    }
    if (j.errors && j.errors.length > 0) {
      const summary = j.errors.map((e) => `${e.code}: ${e.message}`).join('\n');
      alert(`Cálculo terminó con errores:\n${summary}`);
    }
    fetchPayfiles(selectedWeek);
  }

  const totalAmount = useMemo(() => {
    if (!data) return 0;
    return data.payfiles.reduce((acc, p) => acc + Number(p.total_amount), 0);
  }, [data]);

  if (weeks.length === 0 && !loading) {
    return (
      <div className="text-center py-16 text-gray-400 text-sm">
        {t('payroll.payfiles.empty')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">
            {t('payroll.salesByWeek.weekLabel')}
          </label>
          <select
            value={selectedWeek}
            onChange={(e) => setSelectedWeek(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          >
            {weeks.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <button
          onClick={() => selectedWeek && fetchPayfiles(selectedWeek)}
          className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-xs"
        >
          {t('common.refresh')}
        </button>
        <button
          onClick={handleCalculate}
          disabled={calcRunning || !selectedWeek}
          className="px-3 py-1.5 rounded-lg text-white font-semibold text-xs disabled:opacity-60"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          {calcRunning ? t('payroll.payfiles.calculating') : t('payroll.payfiles.calculate')}
        </button>
        <div className="ml-auto text-xs text-gray-500 dark:text-gray-400">
          {data && (
            <>
              {data.payfiles.length} {t('payroll.payfiles.payfilesCount')} · {t('payroll.payfiles.total')} <span className="font-bold text-gray-800 dark:text-gray-100">${totalAmount.toFixed(2)}</span>
            </>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-3 sm:px-5 py-3 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">{t('payroll.payfiles.listTitle')}</h3>
        </div>
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('common.loading')}</div>
        ) : !data || data.payfiles.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('payroll.payfiles.noneForWeek')}</div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {data.payfiles.map((pf) => (
              <PayfileRow
                key={pf.id}
                pf={pf}
                expanded={expanded.has(pf.id)}
                onToggle={() => {
                  const n = new Set(expanded);
                  if (n.has(pf.id)) n.delete(pf.id);
                  else n.add(pf.id);
                  setExpanded(n);
                }}
                onEdit={setEditing}
                onAdd={() => setAdding(pf)}
                onDelete={async (li) => {
                  if (!confirm(t('payroll.payfiles.confirmDelete'))) return;
                  const r = await fetch(`/api/payroll/payfile-line-items/${li.id}`, { method: 'DELETE' });
                  if (!r.ok) {
                    const j = await r.json().catch(() => ({}));
                    alert(j.error || 'Error');
                    return;
                  }
                  fetchPayfiles(selectedWeek);
                }}
                onWithdraw={() => fetchPayfiles(selectedWeek)}
                t={t}
                lang={lang}
              />
            ))}
          </div>
        )}
      </div>

      {editing && (
        <EditLineItemModal
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); fetchPayfiles(selectedWeek); }}
        />
      )}
      {adding && (
        <AddLineItemModal
          payfile={adding}
          onClose={() => setAdding(null)}
          onSaved={() => { setAdding(null); fetchPayfiles(selectedWeek); }}
        />
      )}
    </div>
  );
}

// ── Payfile row + expand ────────────────────────────────────────────────────

interface PayfileRowProps {
  pf: PayfileWithItems;
  expanded: boolean;
  onToggle: () => void;
  onEdit: (li: PayfileLineItem) => void;
  onAdd: () => void;
  onDelete: (li: PayfileLineItem) => void;
  onWithdraw: (li: PayfileLineItem) => void;
  t: (k: string) => string;
  lang: 'es' | 'en';
}

function PayfileRow({ pf, expanded, onToggle, onEdit, onAdd, onDelete, onWithdraw, t, lang }: PayfileRowProps) {
  const hasCeoFlag = pf.line_items.some((li) => li.requires_ceo_approval);
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full text-left grid grid-cols-12 gap-2 items-center px-3 sm:px-5 py-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors"
      >
        <div className="col-span-12 sm:col-span-5 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            {pf.user?.name ?? pf.user_id}
            {pf.user?.role && (
              <span className="ml-2 text-[10px] text-gray-400 font-normal">{pf.user.role}</span>
            )}
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5">{pf.line_items.length} {t('payroll.payfiles.linesShort')}</p>
        </div>
        <div className="col-span-6 sm:col-span-3 text-[11px]">
          <StateBadge state={pf.state} lang={lang} />
          {hasCeoFlag && (
            <span className="ml-1 inline-block bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 px-1.5 py-0.5 rounded text-[9px] font-bold">
              CEO
            </span>
          )}
        </div>
        <div className="col-span-6 sm:col-span-3 text-right font-mono text-sm font-bold text-gray-900 dark:text-gray-100">
          ${Number(pf.total_amount).toFixed(2)}
        </div>
        <div className="col-span-12 sm:col-span-1 text-[10px] text-gray-400 sm:text-right">{expanded ? '▾' : '▸'}</div>
      </button>

      {expanded && (
        <div className="bg-gray-50/50 dark:bg-gray-800/30 border-t border-gray-100 dark:border-gray-700 px-3 sm:px-5 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wide font-bold text-gray-500 dark:text-gray-400">{t('payroll.payfiles.itemsTitle')}</p>
            <button
              onClick={onAdd}
              className="text-xs text-[var(--primary)] hover:underline font-semibold"
            >
              + {t('payroll.payfiles.addLine')}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="text-left px-2 py-1">{t('payroll.payfiles.colType')}</th>
                  <th className="text-left px-2 py-1">{t('payroll.payfiles.colDescription')}</th>
                  <th className="text-right px-2 py-1">{t('payroll.payfiles.colOriginal')}</th>
                  <th className="text-right px-2 py-1">{t('payroll.payfiles.colAmount')}</th>
                  <th className="text-center px-2 py-1">{t('payroll.payfiles.colFlags')}</th>
                  <th className="text-right px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {pf.line_items.map((li) => (
                  <tr key={li.id} className="border-t border-gray-100 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-900/50">
                    <td className="px-2 py-1">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                        {payfileLineTypeLabel(li.line_type as PayfileLineType, lang).toUpperCase()}
                      </span>
                    </td>
                    <td className="px-2 py-1 max-w-[280px] truncate text-gray-700 dark:text-gray-200" title={li.description}>
                      {li.description}
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-gray-500 dark:text-gray-400">${Number(li.original_amount).toFixed(2)}</td>
                    <td className="px-2 py-1 text-right font-mono font-bold text-gray-900 dark:text-gray-100">${Number(li.amount).toFixed(2)}</td>
                    <td className="px-2 py-1 text-center">
                      {li.is_manually_edited && <FlagPill color="indigo" label="EDIT" />}
                      {li.is_manually_added && <FlagPill color="violet" label="ADD" />}
                      {li.is_over_received_amount && !li.is_over_3x_received && <FlagPill color="amber" label="&gt;JE" />}
                      {li.is_over_3x_received && <FlagPill color="rose" label={`>${OVER_RECEIVED_MULTIPLE}x`} />}
                      {li.requires_ceo_approval && <FlagPill color="rose" label="CEO" />}
                    </td>
                    <td className="px-2 py-1 text-right whitespace-nowrap">
                      <button onClick={() => onEdit(li)} className="text-[var(--primary)] hover:underline text-xs">
                        {t('common.edit')}
                      </button>
                      {li.line_type === 'NEGATIVE_BALANCE_COLLECTION' && !li.is_manually_added && (
                        <>
                          {' · '}
                          <button
                            onClick={async () => {
                              if (!confirm(t('payroll.payfiles.confirmWithdrawCollection'))) return;
                              const r = await fetch(`/api/payroll/payfile-line-items/${li.id}/withdraw-collection`, { method: 'POST' });
                              if (!r.ok) {
                                const j = await r.json().catch(() => ({}));
                                alert(j.error || t('common.error'));
                                return;
                              }
                              onWithdraw(li);
                            }}
                            className="text-amber-600 hover:underline text-xs"
                          >
                            {t('payroll.payfiles.withdrawCollection')}
                          </button>
                        </>
                      )}
                      {li.is_manually_added && (
                        <>
                          {' · '}
                          <button onClick={() => onDelete(li)} className="text-rose-600 hover:underline text-xs">
                            {t('common.delete')}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Edit modal ──────────────────────────────────────────────────────────────

interface EditModalProps {
  item: PayfileLineItem;
  onClose: () => void;
  onSaved: () => void;
}

function EditLineItemModal({ item, onClose, onSaved }: EditModalProps) {
  const { t } = useLanguage();
  const [amount, setAmount] = useState(String(item.amount));
  const [editNote, setEditNote] = useState(item.edit_note ?? 'AJUSTE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true); setError('');
    const r = await fetch(`/api/payroll/payfile-line-items/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: Number(amount), edit_note: editNote }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(j.error || 'Error'); return; }
    if (j.requires_ceo_approval) {
      alert(t('payroll.payfiles.ceoRequiredHint'));
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white dark:bg-gray-900 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h4 className="font-bold text-gray-800 dark:text-gray-100">{t('payroll.payfiles.editTitle')}</h4>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="text-xs text-gray-500 bg-gray-50 dark:bg-gray-800 rounded-xl p-2.5">
            <p className="font-mono">{item.description}</p>
            <p className="mt-1">{t('payroll.payfiles.colOriginal')}: ${Number(item.original_amount).toFixed(2)}</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('payroll.payfiles.newAmount')}</label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('payroll.payfiles.note')}</label>
            <input
              type="text"
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>
          {error && <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-sm">{t('common.cancel')}</button>
            <button onClick={save} disabled={busy} className="flex-1 py-2.5 rounded-xl text-white font-bold text-sm disabled:opacity-60" style={{ backgroundColor: 'var(--primary)' }}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Add line item modal ─────────────────────────────────────────────────────

function AddLineItemModal({ payfile, onClose, onSaved }: { payfile: PayfileWithItems; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage();
  const [lineType, setLineType] = useState<PayfileLineType>('MANUAL_ADJUSTMENT');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true); setError('');
    const r = await fetch('/api/payroll/payfile-line-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payfile_id: payfile.id,
        line_type: lineType,
        description,
        amount: Number(amount),
      }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(j.error || 'Error'); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white dark:bg-gray-900 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h4 className="font-bold text-gray-800 dark:text-gray-100">{t('payroll.payfiles.addTitle')}</h4>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-[11px] text-gray-500">{t('payroll.payfiles.addingTo')} <span className="font-bold">{payfile.user?.name ?? payfile.user_id}</span></p>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('payroll.payfiles.colType')}</label>
            <select value={lineType} onChange={(e) => setLineType(e.target.value as PayfileLineType)} className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
              <option value="MANUAL_ADJUSTMENT">MANUAL_ADJUSTMENT</option>
              <option value="COMPANY_BONUS">COMPANY_BONUS</option>
              <option value="COLLECTION">COLLECTION</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('payroll.payfiles.colDescription')}</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('payroll.payfiles.newAmount')}</label>
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
          </div>
          {error && <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-sm">{t('common.cancel')}</button>
            <button onClick={save} disabled={busy || !description || !amount} className="flex-1 py-2.5 rounded-xl text-white font-bold text-sm disabled:opacity-60" style={{ backgroundColor: 'var(--primary)' }}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tiny presentational helpers ─────────────────────────────────────────────

function FlagPill({ color, label }: { color: string; label: string }) {
  const colors: Record<string, string> = {
    indigo: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',
    violet: 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300',
    amber:  'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    rose:   'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300',
  };
  return (
    <span className={`inline-block ml-0.5 px-1 py-0.5 rounded text-[8.5px] font-bold ${colors[color] ?? colors.indigo}`} dangerouslySetInnerHTML={{ __html: label }} />
  );
}

function StateBadge({ state, lang }: { state: PayfileState; lang: 'es' | 'en' }) {
  const color =
    state === 'DRAFT'            ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200' :
    state === 'PENDING_APPROVAL' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
    state === 'APPROVED'         ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
    state === 'PUBLISHED'        ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
    /* REJECTED */                 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>
      {payfileStateLabel(state, lang)}
    </span>
  );
}
