'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/components/LanguageContext';
import { collectionStatusLabel, collectionInstallmentStatusLabel } from '@/lib/payroll/labels';
import type { Collection, CollectionInstallment } from '@/types/payroll';
import type { CollectionStatus, CollectionInstallmentStatus } from '@/lib/payroll/constants';

/**
 * Block 09 — Collections tab.
 *
 * Admin/CEO create, view, edit, cancel collections. Each collection has
 * N installments that get applied during the weekly payfile calc.
 */

interface UserOption { id: string; name: string; role: string; payroll_status: 'active' | 'inactive' }
interface CollectionRow extends Collection {
  debtor: UserOption | null;
  beneficiary: UserOption | null;
  progress: { collected: number; total: number; partial: boolean };
  next_pending: { installment_number: number; scheduled_week: string; amount: number } | null;
}
interface CollectionDetail {
  collection: Collection;
  debtor: UserOption | null;
  beneficiary: UserOption | null;
  installments: CollectionInstallment[];
  history: Array<{ id: string; payfile_id: string; line_type: string; amount: number; created_at: string; payfiles: unknown }>;
}

export default function CollectionsTab() {
  const { t, lang } = useLanguage();
  const [rows, setRows] = useState<CollectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('ACTIVE,COMPLETED');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const url = new URL('/api/payroll/collections', window.location.origin);
    if (statusFilter) url.searchParams.set('status', statusFilter);
    const r = await fetch(url.pathname + url.search);
    if (r.ok) setRows((await r.json()).rows ?? []);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { refresh(); }, [refresh]);

  // Load users once for the create-modal selectors.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The roster endpoint already returns users with role + payroll_status.
      const r = await fetch('/api/payroll/roster');
      if (!r.ok || cancelled) return;
      const list = await r.json();
      if (cancelled) return;
      setUsers((list ?? []) as UserOption[]);
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.description.toLowerCase().includes(q) ||
      (r.debtor?.name ?? '').toLowerCase().includes(q) ||
      (r.beneficiary?.name ?? '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  return (
    <div className="space-y-4">
      {/* Header + filters */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-3 sm:p-4">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">
              {t('common.search')}
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('payroll.collections.searchPlaceholder')}
              className="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">
              {t('payroll.collections.statusFilter')}
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs"
            >
              <option value="ACTIVE,COMPLETED">{t('payroll.collections.openOrDone')}</option>
              <option value="ACTIVE">{collectionStatusLabel('ACTIVE', lang)}</option>
              <option value="COMPLETED">{collectionStatusLabel('COMPLETED', lang)}</option>
              <option value="CANCELLED">{collectionStatusLabel('CANCELLED', lang)}</option>
              <option value="">{lang === 'es' ? 'Todas' : 'All'}</option>
            </select>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="ml-auto px-4 py-2 rounded-xl text-white font-semibold text-sm"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            + {t('payroll.collections.createBtn')}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-3 sm:px-5 py-3 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">{t('payroll.collections.listTitle')}</h3>
          <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full px-2.5 py-0.5 font-semibold">{filtered.length}</span>
        </div>
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('common.loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('common.noData')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2 text-left">{t('payroll.collections.colDescription')}</th>
                  <th className="px-3 py-2 text-left">{t('payroll.collections.colDebtor')}</th>
                  <th className="px-3 py-2 text-left">{t('payroll.collections.colBeneficiary')}</th>
                  <th className="px-3 py-2 text-right">{t('payroll.collections.colTotal')}</th>
                  <th className="px-3 py-2 text-center">{t('payroll.collections.colProgress')}</th>
                  <th className="px-3 py-2 text-left">{t('payroll.collections.colNext')}</th>
                  <th className="px-3 py-2 text-left">{t('payroll.collections.colStatus')}</th>
                  <th className="px-3 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-200 max-w-[260px] truncate" title={r.description}>{r.description}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-200 whitespace-nowrap">{r.debtor?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-200 whitespace-nowrap">{r.beneficiary?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700 dark:text-gray-200">${Number(r.total_amount).toFixed(2)}</td>
                    <td className="px-3 py-2 text-center text-gray-600 dark:text-gray-300 font-mono">{r.progress.collected}/{r.progress.total}{r.progress.partial && '*'}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 font-mono text-[10px]">
                      {r.next_pending ? `${r.next_pending.scheduled_week} (#${r.next_pending.installment_number})` : '—'}
                    </td>
                    <td className="px-3 py-2"><StatusBadge status={r.status} lang={lang} /></td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => setDetail(r.id)} className="text-[var(--primary)] hover:underline">{t('common.viewDetail')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <CreateCollectionModal
          users={users}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); refresh(); }}
        />
      )}

      {detail && (
        <DetailModal
          id={detail}
          users={users}
          onClose={() => setDetail(null)}
          onChanged={() => { refresh(); }}
          onCancelled={() => { setDetail(null); refresh(); }}
        />
      )}
    </div>
  );
}

// ── Create modal ────────────────────────────────────────────────────────────

function CreateCollectionModal({
  users, onClose, onCreated,
}: {
  users: UserOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useLanguage();
  const [description, setDescription] = useState('');
  const [debtorId, setDebtorId] = useState('');
  const [beneficiaryId, setBeneficiaryId] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [installments, setInstallments] = useState('1');
  const [startWeek, setStartWeek] = useState(nextFriday());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const beneficiaryOptions = useMemo(
    () => users.filter((u) => u.role !== 'admin'),
    [users],
  );

  const perInstallment = useMemo(() => {
    const total = Number(totalAmount);
    const n = Number(installments);
    if (!Number.isFinite(total) || total <= 0 || !Number.isInteger(n) || n < 1) return null;
    const base = Math.floor((total * 100) / n) / 100;
    const last = (total - base * (n - 1)).toFixed(2);
    return { base: base.toFixed(2), last };
  }, [totalAmount, installments]);

  const beneficiaryIsCeo = useMemo(
    () => beneficiaryOptions.find((u) => u.id === beneficiaryId)?.role === 'ceo',
    [beneficiaryOptions, beneficiaryId],
  );

  async function submit() {
    setBusy(true); setError('');
    if (beneficiaryIsCeo) {
      if (!confirm(t('payroll.collections.confirmCeoBeneficiary'))) {
        setBusy(false);
        return;
      }
    }
    const r = await fetch('/api/payroll/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description,
        debtor_id: debtorId,
        beneficiary_id: beneficiaryId,
        total_amount: Number(totalAmount),
        installments: Number(installments),
        start_week: startWeek,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error || t('common.error'));
      return;
    }
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white dark:bg-gray-900 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h4 className="font-bold text-gray-800 dark:text-gray-100">{t('payroll.collections.createTitle')}</h4>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-3">
          <Field label={t('payroll.collections.descLabel')}>
            <input
              type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder={t('payroll.collections.descPlaceholder')}
              className={inputClass}
            />
          </Field>
          <Field label={t('payroll.collections.debtorLabel')}>
            <UserSelect users={users} value={debtorId} onChange={setDebtorId} placeholder={t('payroll.collections.pickDebtor')} />
          </Field>
          <Field label={t('payroll.collections.beneficiaryLabel')}>
            <UserSelect users={beneficiaryOptions} value={beneficiaryId} onChange={setBeneficiaryId} placeholder={t('payroll.collections.pickBeneficiary')} />
            <p className="text-[10px] text-gray-400 mt-1">{t('payroll.collections.beneficiaryHint')}</p>
          </Field>
          {beneficiaryIsCeo && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 px-3 py-2 text-[11px]">
              {t('payroll.collections.ceoNotice')}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('payroll.collections.totalLabel')}>
              <input
                type="number" step="0.01" min="0" value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)} className={inputClass}
              />
            </Field>
            <Field label={t('payroll.collections.installmentsLabel')}>
              <input
                type="number" step="1" min="1" value={installments}
                onChange={(e) => setInstallments(e.target.value)} className={inputClass}
              />
            </Field>
          </div>
          {perInstallment && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {t('payroll.collections.perInstallment')}: <span className="font-mono">${perInstallment.base}</span>
              {perInstallment.last !== perInstallment.base && <> · {t('payroll.collections.lastInstallment')}: <span className="font-mono">${perInstallment.last}</span></>}
            </p>
          )}
          <Field label={t('payroll.collections.startWeekLabel')}>
            <input type="date" value={startWeek} onChange={(e) => setStartWeek(e.target.value)} className={inputClass} />
          </Field>
          {error && <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-sm">{t('common.cancel')}</button>
            <button
              onClick={submit}
              disabled={busy || !description.trim() || !debtorId || !beneficiaryId || !totalAmount || !installments || !startWeek}
              className="flex-1 py-2.5 rounded-xl text-white font-bold text-sm disabled:opacity-50"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              {busy ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Detail modal ────────────────────────────────────────────────────────────

function DetailModal({
  id, users, onClose, onChanged, onCancelled,
}: {
  id: string;
  users: UserOption[];
  onClose: () => void;
  onChanged: () => void;
  onCancelled: () => void;
}) {
  const { t, lang } = useLanguage();
  const [data, setData] = useState<CollectionDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [descEdit, setDescEdit] = useState('');
  const [benefEdit, setBenefEdit] = useState('');

  const load = useCallback(async () => {
    const r = await fetch(`/api/payroll/collections/${id}`);
    if (r.ok) {
      const j: CollectionDetail = await r.json();
      setData(j);
      setDescEdit(j.collection.description);
      setBenefEdit(j.collection.beneficiary_id ?? '');
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

  const c = data.collection;
  const hasCollected = data.installments.some(
    (i) => i.status === 'FULLY_COLLECTED' || i.status === 'PARTIALLY_COLLECTED',
  );

  async function saveEdit() {
    setBusy(true); setError('');
    const patch: Record<string, unknown> = {};
    if (descEdit.trim() !== c.description) patch.description = descEdit.trim();
    if (benefEdit !== c.beneficiary_id) patch.beneficiary_id = benefEdit;
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      setBusy(false);
      return;
    }
    const r = await fetch(`/api/payroll/collections/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error || t('common.error'));
      return;
    }
    setEditing(false);
    await load();
    onChanged();
  }

  async function doCancel() {
    const reason = window.prompt(t('payroll.collections.cancelReasonPrompt'));
    if (reason === null) return;
    setBusy(true);
    const r = await fetch(`/api/payroll/collections/${id}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.error || t('common.error'));
      return;
    }
    onCancelled();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white dark:bg-gray-900 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="min-w-0">
            <h4 className="font-bold text-gray-800 dark:text-gray-100 truncate text-sm">{c.description}</h4>
            <p className="text-[10px] text-gray-400 mt-0.5">${Number(c.total_amount).toFixed(2)} · {c.installments} {t('payroll.collections.installmentsLabel').toLowerCase()}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="rounded-xl bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs grid grid-cols-2 gap-1 text-gray-700 dark:text-gray-200">
            <div><span className="text-gray-500">{t('payroll.collections.colDebtor')}:</span> <span className="font-semibold">{data.debtor?.name ?? '—'}</span></div>
            <div><span className="text-gray-500">{t('payroll.collections.colBeneficiary')}:</span> <span className="font-semibold">{data.beneficiary?.name ?? '—'}</span> {data.beneficiary?.role && <span className="text-[10px] text-gray-400">({data.beneficiary.role})</span>}</div>
            <div><span className="text-gray-500">{t('payroll.collections.startWeekLabel')}:</span> <span className="font-mono">{c.start_week}</span></div>
            <div><span className="text-gray-500">{t('payroll.collections.colStatus')}:</span> <StatusBadge status={c.status} lang={lang} /></div>
          </div>

          {editing ? (
            <div className="space-y-2 border border-gray-200 dark:border-gray-700 rounded-xl p-3 bg-gray-50/50 dark:bg-gray-800/30">
              <Field label={t('payroll.collections.descLabel')}>
                <input type="text" value={descEdit} onChange={(e) => setDescEdit(e.target.value)} className={inputClass} />
              </Field>
              <Field label={t('payroll.collections.beneficiaryLabel')}>
                <UserSelect users={users.filter((u) => u.role !== 'admin')} value={benefEdit} onChange={setBenefEdit} placeholder={t('payroll.collections.pickBeneficiary')} disabled={hasCollected} />
                {hasCollected && (
                  <p className="text-[10px] text-amber-600 mt-1">{t('payroll.collections.cantChangeBeneficiary')}</p>
                )}
              </Field>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex gap-2">
                <button onClick={() => { setEditing(false); setError(''); }} className="flex-1 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs">{t('common.cancel')}</button>
                <button onClick={saveEdit} disabled={busy} className="flex-1 py-2 rounded-lg text-white text-xs" style={{ backgroundColor: 'var(--primary)' }}>{busy ? t('common.saving') : t('common.save')}</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {c.status === 'ACTIVE' && (
                <>
                  <button onClick={() => setEditing(true)} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold">
                    {t('common.edit')}
                  </button>
                  <button onClick={doCancel} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold disabled:opacity-50">
                    {t('payroll.collections.cancelBtn')}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Installments */}
          <div>
            <p className="text-[10px] uppercase tracking-wide font-bold text-gray-500 dark:text-gray-400 mb-1">{t('payroll.collections.installmentsTitle')}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="text-left px-2 py-1">#</th>
                    <th className="text-left px-2 py-1">{t('payroll.collections.colScheduled')}</th>
                    <th className="text-right px-2 py-1">{t('payroll.collections.colAmount')}</th>
                    <th className="text-right px-2 py-1">{t('payroll.collections.colCollected')}</th>
                    <th className="text-left px-2 py-1">{t('payroll.collections.colStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.installments.map((inst) => (
                    <tr key={inst.id} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="px-2 py-1 font-bold text-gray-700 dark:text-gray-200">{inst.installment_number}</td>
                      <td className="px-2 py-1 text-gray-500 dark:text-gray-400 font-mono text-[10px]">{inst.scheduled_week}</td>
                      <td className="px-2 py-1 text-right font-mono text-gray-700 dark:text-gray-200">${Number(inst.amount).toFixed(2)}</td>
                      <td className="px-2 py-1 text-right font-mono text-emerald-700 dark:text-emerald-300">${Number(inst.collected_amount).toFixed(2)}</td>
                      <td className="px-2 py-1"><InstallmentStatusBadge status={inst.status as CollectionInstallmentStatus} lang={lang} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tiny helpers ────────────────────────────────────────────────────────────

function UserSelect({
  users, value, onChange, placeholder, disabled,
}: { users: UserOption[]; value: string; onChange: (v: string) => void; placeholder: string; disabled?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={inputClass + (disabled ? ' opacity-60' : '')}>
      <option value="">{placeholder}</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name} ({u.role}) {u.payroll_status === 'inactive' ? '· inactive' : ''}
        </option>
      ))}
    </select>
  );
}

function StatusBadge({ status, lang }: { status: CollectionStatus; lang: 'es' | 'en' }) {
  const color =
    status === 'ACTIVE'    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
    status === 'COMPLETED' ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300' :
                             'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300';
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>{collectionStatusLabel(status, lang)}</span>;
}

function InstallmentStatusBadge({ status, lang }: { status: CollectionInstallmentStatus; lang: 'es' | 'en' }) {
  const color =
    status === 'FULLY_COLLECTED'     ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
    status === 'PARTIALLY_COLLECTED' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
    status === 'CANCELLED'           ? 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300' :
                                       'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300';
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>{collectionInstallmentStatusLabel(status, lang)}</span>;
}

const inputClass = 'w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

function nextFriday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((5 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}
