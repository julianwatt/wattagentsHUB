'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/components/LanguageContext';
import { companyBonusTypeLabel } from '@/lib/payroll/labels';
import { COMPANY_BONUS_TYPES, type CompanyBonusType } from '@/lib/payroll/constants';
import type { CompanyBonus, BonusDistribution } from '@/types/payroll';

/**
 * Block 10 — Bonos de Empresa tab.
 *
 * Lists company_bonuses + distribute / edit / delete distributions UI.
 */

interface BonusRow extends CompanyBonus {
  distributed_total: number;
  recipient_count: number;
  remaining_for_company: number;
}

interface UserOption { id: string; name: string; role: string; payroll_status: 'active' | 'inactive' }

interface DistributionRow extends BonusDistribution {
  recipient: UserOption | null;
  applied_to_payfile: { payfile_id: string; state: string; pay_week: string; line_item_id: string } | null;
}

interface BonusDetail {
  bonus: CompanyBonus;
  source_sale: { id: string; contract_id: string; customer_name: string | null; plan_name: string; agent_id: string | null } | null;
  distributions: DistributionRow[];
}

export default function BonosTab() {
  const { t, lang } = useLanguage();
  const [rows, setRows] = useState<BonusRow[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [distributedFilter, setDistributedFilter] = useState<string>('0'); // default: pending
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [distributing, setDistributing] = useState<BonusRow | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const url = new URL('/api/payroll/company-bonuses', window.location.origin);
    if (typeFilter) url.searchParams.set('bonus_type', typeFilter);
    if (distributedFilter) url.searchParams.set('distributed', distributedFilter);
    if (search) url.searchParams.set('search', search);
    const r = await fetch(url.pathname + url.search);
    if (r.ok) {
      const j = await r.json();
      setRows(j.rows ?? []);
      setPending(j.summary?.pending ?? 0);
    }
    setLoading(false);
  }, [typeFilter, distributedFilter, search]);

  useEffect(() => { refresh(); }, [refresh]);

  // Load users once for distribute modal selectors.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetch('/api/payroll/roster');
      if (!r.ok || cancelled) return;
      const list = await r.json();
      if (cancelled) return;
      setUsers((list ?? []) as UserOption[]);
    })();
    return () => { cancelled = true; };
  }, []);

  function handleExport() {
    const url = new URL('/api/payroll/company-bonuses', window.location.origin);
    if (typeFilter) url.searchParams.set('bonus_type', typeFilter);
    if (distributedFilter) url.searchParams.set('distributed', distributedFilter);
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
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">
              {t('common.search')}
            </label>
            <input
              type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={t('payroll.bonos.searchPlaceholder')}
              className="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">
              {t('payroll.bonos.typeFilter')}
            </label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs">
              <option value="">{lang === 'es' ? 'Todos' : 'All'}</option>
              {COMPANY_BONUS_TYPES.map((t) => (<option key={t} value={t}>{companyBonusTypeLabel(t, lang)}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">
              {t('payroll.bonos.distributedFilter')}
            </label>
            <select value={distributedFilter} onChange={(e) => setDistributedFilter(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs">
              <option value="">{lang === 'es' ? 'Todos' : 'All'}</option>
              <option value="0">{t('payroll.bonos.pendingOnly')}</option>
              <option value="1">{t('payroll.bonos.distributedOnly')}</option>
            </select>
          </div>
          <button onClick={handleExport} className="ml-auto px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-xs">
            {t('payroll.bonos.exportCsv')}
          </button>
        </div>
        {pending > 0 && (
          <div className="mt-2 inline-flex items-center gap-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full text-[10px] font-bold">
            ⚠ {pending} {t('payroll.bonos.pendingHint')}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-3 sm:px-5 py-3 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">{t('payroll.bonos.listTitle')}</h3>
          <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full px-2.5 py-0.5 font-semibold">{rows.length}</span>
        </div>
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('common.loading')}</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('common.noData')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2 text-left">{t('payroll.bonos.colType')}</th>
                  <th className="px-3 py-2 text-left">{t('payroll.bonos.colDescription')}</th>
                  <th className="px-3 py-2 text-left">{t('payroll.bonos.colWeek')}</th>
                  <th className="px-3 py-2 text-right">{t('payroll.bonos.colTotal')}</th>
                  <th className="px-3 py-2 text-right">{t('payroll.bonos.colDistributed')}</th>
                  <th className="px-3 py-2 text-right">{t('payroll.bonos.colRemaining')}</th>
                  <th className="px-3 py-2 text-center">{t('payroll.bonos.colStatus')}</th>
                  <th className="px-3 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                    <td className="px-3 py-2">
                      <span className="inline-block bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full text-[10px] font-bold">
                        {companyBonusTypeLabel(r.bonus_type as CompanyBonusType, lang)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-200 max-w-[300px] truncate" title={r.description}>{r.description}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 font-mono text-[10px]">{r.pay_week}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700 dark:text-gray-200">${Number(r.total_amount).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-700 dark:text-emerald-300">${r.distributed_total.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-500 dark:text-gray-400">${r.remaining_for_company.toFixed(2)}</td>
                    <td className="px-3 py-2 text-center">
                      {r.paid_to_agents
                        ? <span className="inline-block bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full text-[10px] font-bold">{t('payroll.bonos.distributedTag')}</span>
                        : <span className="inline-block bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full text-[10px] font-bold">{t('payroll.bonos.pendingTag')}</span>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => setDetailId(r.id)} className="text-[var(--primary)] hover:underline">{t('common.viewDetail')}</button>
                      {' · '}
                      <button onClick={() => setDistributing(r)} className="text-[var(--primary)] hover:underline">{t('payroll.bonos.distribute')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detailId && (
        <DetailModal id={detailId} users={users} onClose={() => setDetailId(null)} onChanged={refresh} />
      )}
      {distributing && (
        <DistributeModal bonus={distributing} users={users} onClose={() => setDistributing(null)} onDistributed={() => { setDistributing(null); refresh(); }} />
      )}
    </div>
  );
}

// ── Distribute modal ────────────────────────────────────────────────────────

function DistributeModal({
  bonus, users, onClose, onDistributed,
}: {
  bonus: BonusRow;
  users: UserOption[];
  onClose: () => void;
  onDistributed: () => void;
}) {
  const { t } = useLanguage();
  interface Split { recipient_id: string; amount: string; pay_week: string; notes: string }
  const [splits, setSplits] = useState<Split[]>([{ recipient_id: '', amount: '', pay_week: bonus.pay_week, notes: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const sum = useMemo(() => splits.reduce((acc, s) => acc + (Number(s.amount) || 0), 0), [splits]);
  const remaining = Number(bonus.total_amount) - sum;

  function update(idx: number, patch: Partial<Split>) {
    setSplits((cur) => cur.map((s, i) => i === idx ? { ...s, ...patch } : s));
  }
  function addRow() {
    setSplits((cur) => [...cur, { recipient_id: '', amount: '', pay_week: bonus.pay_week, notes: '' }]);
  }
  function removeRow(idx: number) {
    setSplits((cur) => cur.filter((_, i) => i !== idx));
  }

  async function submit() {
    setBusy(true); setError('');
    const r = await fetch(`/api/payroll/company-bonuses/${bonus.id}/distribute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        splits: splits.map((s) => ({
          recipient_id: s.recipient_id,
          amount: Number(s.amount),
          pay_week: s.pay_week,
          notes: s.notes || null,
        })),
      }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error || t('common.error'));
      return;
    }
    onDistributed();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white dark:bg-gray-900 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div>
            <h4 className="font-bold text-gray-800 dark:text-gray-100 text-sm">{t('payroll.bonos.distributeTitle')}</h4>
            <p className="text-[10px] text-gray-400 mt-0.5">{bonus.description} · ${Number(bonus.total_amount).toFixed(2)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-3">
          {splits.map((s, i) => (
            <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400">#{i + 1}</p>
                {splits.length > 1 && (
                  <button onClick={() => removeRow(i)} className="text-rose-600 text-[11px] hover:underline">{t('common.delete')}</button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('payroll.bonos.recipient')}>
                  <select
                    value={s.recipient_id} onChange={(e) => update(i, { recipient_id: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">{t('payroll.bonos.pickRecipient')}</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                    ))}
                  </select>
                </Field>
                <Field label={t('payroll.bonos.amount')}>
                  <input
                    type="number" step="0.01" min="0" value={s.amount}
                    onChange={(e) => update(i, { amount: e.target.value })} className={inputClass}
                  />
                </Field>
                <Field label={t('payroll.bonos.payWeek')}>
                  <input type="date" value={s.pay_week} onChange={(e) => update(i, { pay_week: e.target.value })} className={inputClass} />
                </Field>
                <Field label={t('payroll.bonos.notesLabel')}>
                  <input type="text" value={s.notes} onChange={(e) => update(i, { notes: e.target.value })} className={inputClass} />
                </Field>
              </div>
            </div>
          ))}
          <button onClick={addRow} className="text-xs text-[var(--primary)] hover:underline font-semibold">
            + {t('payroll.bonos.addRecipient')}
          </button>
          <div className="rounded-xl bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs flex justify-between">
            <span className="text-gray-600 dark:text-gray-300">{t('payroll.bonos.distributedSum')}</span>
            <span className="font-mono font-bold">${sum.toFixed(2)}</span>
          </div>
          <div className="rounded-xl bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs flex justify-between">
            <span className="text-gray-600 dark:text-gray-300">{t('payroll.bonos.remainingCompany')}</span>
            <span className={`font-mono font-bold ${remaining < 0 ? 'text-rose-600' : 'text-gray-700 dark:text-gray-200'}`}>
              ${remaining.toFixed(2)}
            </span>
          </div>
          {remaining < 0 && (
            <p className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-900/20 rounded-xl px-3 py-2">
              {t('payroll.bonos.overTotalWarning')}
            </p>
          )}
          {error && <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-sm">{t('common.cancel')}</button>
            <button
              onClick={submit}
              disabled={busy || remaining < 0 || splits.some((s) => !s.recipient_id || !s.amount || !s.pay_week)}
              className="flex-1 py-2.5 rounded-xl text-white font-bold text-sm disabled:opacity-50"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              {busy ? t('common.saving') : t('payroll.bonos.confirmDistribute')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Detail modal ────────────────────────────────────────────────────────────

function DetailModal({
  id, users, onClose, onChanged,
}: {
  id: string;
  users: UserOption[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t, lang } = useLanguage();
  const [data, setData] = useState<BonusDetail | null>(null);
  const [notesEdit, setNotesEdit] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const r = await fetch(`/api/payroll/company-bonuses/${id}`);
    if (r.ok) {
      const j: BonusDetail = await r.json();
      setData(j);
      setNotesEdit(j.bonus.notes ?? '');
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!data) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
        <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 text-gray-400">{t('common.loading')}</div>
      </div>
    );
  }

  async function saveNotes() {
    setBusy(true); setError('');
    const r = await fetch(`/api/payroll/company-bonuses/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: notesEdit }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error || t('common.error'));
      return;
    }
    onChanged();
    load();
  }

  async function deleteDistribution(distId: string) {
    if (!confirm(t('payroll.bonos.confirmDeleteDist'))) return;
    setBusy(true);
    const r = await fetch(`/api/payroll/bonus-distributions/${distId}`, { method: 'DELETE' });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.error || t('common.error'));
      return;
    }
    onChanged();
    load();
  }

  const b = data.bonus;
  const raw = b.original_je_data ?? {};

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white dark:bg-gray-900 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div>
            <h4 className="font-bold text-gray-800 dark:text-gray-100 text-sm">{b.description}</h4>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {companyBonusTypeLabel(b.bonus_type, lang)} · PW {b.pay_week} · ${Number(b.total_amount).toFixed(2)}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          {data.source_sale && (
            <div className="rounded-xl bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 px-3 py-2 text-xs">
              <p className="font-bold text-sky-800 dark:text-sky-200">{t('payroll.bonos.fromSale')}</p>
              <p className="text-sky-700 dark:text-sky-300 font-mono text-[10px]">
                {data.source_sale.contract_id} · {data.source_sale.customer_name ?? '—'}
              </p>
              <p className="text-sky-600 dark:text-sky-400">{data.source_sale.plan_name}</p>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
              {t('payroll.bonos.notes')}
            </label>
            <textarea
              value={notesEdit} onChange={(e) => setNotesEdit(e.target.value)} rows={2}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
            />
            <button onClick={saveNotes} disabled={busy} className="mt-1 text-xs text-[var(--primary)] hover:underline font-semibold">
              {busy ? t('common.saving') : t('payroll.bonos.saveNotes')}
            </button>
            {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
          </div>

          {/* Distributions */}
          <div>
            <p className="text-[10px] uppercase tracking-wide font-bold text-gray-500 dark:text-gray-400 mb-1">
              {t('payroll.bonos.distributionsTitle')} ({data.distributions.length})
            </p>
            {data.distributions.length === 0 ? (
              <p className="text-xs text-gray-400 italic">{t('payroll.bonos.noDistributions')}</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="text-left px-2 py-1">{t('payroll.bonos.recipient')}</th>
                    <th className="text-left px-2 py-1">{t('payroll.bonos.payWeek')}</th>
                    <th className="text-right px-2 py-1">{t('payroll.bonos.amount')}</th>
                    <th className="text-left px-2 py-1">{t('payroll.bonos.payfileState')}</th>
                    <th className="text-right px-2 py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.distributions.map((d) => (
                    <tr key={d.id} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="px-2 py-1 text-gray-700 dark:text-gray-200">{d.recipient?.name ?? d.recipient_id}</td>
                      <td className="px-2 py-1 text-gray-500 dark:text-gray-400 font-mono text-[10px]">{d.pay_week}</td>
                      <td className="px-2 py-1 text-right font-mono text-gray-700 dark:text-gray-200">${Number(d.amount).toFixed(2)}</td>
                      <td className="px-2 py-1 text-gray-500 dark:text-gray-400">{d.applied_to_payfile?.state ?? '—'}</td>
                      <td className="px-2 py-1 text-right">
                        <button onClick={() => deleteDistribution(d.id)} className="text-rose-600 hover:underline text-[10px]">
                          {t('common.delete')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Raw JE data */}
          <details className="text-xs">
            <summary className="cursor-pointer text-gray-500 dark:text-gray-400 font-semibold">{t('payroll.bonos.rawData')}</summary>
            <pre className="mt-2 bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-[10px] text-gray-700 dark:text-gray-200 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(raw, null, 2)}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}

// ── tiny helpers ────────────────────────────────────────────────────────────

const inputClass = 'w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}
