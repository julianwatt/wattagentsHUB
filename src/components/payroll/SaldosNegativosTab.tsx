'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/components/LanguageContext';
import { negativeBalanceStatusLabel, negativeBalanceOriginLabel } from '@/lib/payroll/labels';
import type { NegativeBalance } from '@/types/payroll';
import type { NegativeBalanceStatus } from '@/lib/payroll/constants';

/**
 * Block 08 — Saldos Negativos tab.
 *
 * Full table + filters + per-row delete (soft, status=MANUALLY_DELETED).
 * Admin/CEO only.
 */

interface BalanceRow extends NegativeBalance {
  user: { id: string; name: string; role: string | null; payroll_status: 'active' | 'inactive' } | null;
}

export default function SaldosNegativosTab() {
  const { t, lang } = useLanguage();
  const [rows, setRows] = useState<BalanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('PENDING,PARTIALLY_COLLECTED');
  const [originFilter, setOriginFilter] = useState<string>('');
  const [campaignFilter, setCampaignFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<BalanceRow | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const url = new URL('/api/payroll/negative-balances', window.location.origin);
    if (statusFilter) url.searchParams.set('status', statusFilter);
    if (originFilter) url.searchParams.set('origin', originFilter);
    if (campaignFilter) url.searchParams.set('campaign', campaignFilter);
    const r = await fetch(url.pathname + url.search);
    if (r.ok) {
      const j = await r.json();
      setRows(j.rows ?? []);
    }
    setLoading(false);
  }, [statusFilter, originFilter, campaignFilter]);

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      (r.user?.name ?? '').toLowerCase().includes(q) ||
      (r.description ?? '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  const totals = useMemo(() => {
    let original = 0, collected = 0, remaining = 0;
    for (const r of filtered) {
      original += Number(r.original_amount);
      collected += Number(r.collected_amount);
      remaining += Number(r.remaining_amount);
    }
    return { original, collected, remaining };
  }, [filtered]);

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
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('payroll.saldos.searchPlaceholder')}
              className="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>
          <FilterSelect
            label={t('payroll.saldos.statusFilter')}
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'PENDING,PARTIALLY_COLLECTED', label: t('payroll.saldos.statusOpen') },
              { value: 'FULLY_COLLECTED', label: t('payroll.saldos.statusCollected') },
              { value: 'MANUALLY_DELETED', label: t('payroll.saldos.statusDeleted') },
              { value: '', label: t('payroll.saldos.statusAll') },
            ]}
          />
          <FilterSelect
            label={t('payroll.saldos.originFilter')}
            value={originFilter}
            onChange={setOriginFilter}
            options={[
              { value: '', label: lang === 'es' ? 'Todos' : 'All' },
              { value: 'COMMISSION', label: t('payroll.saldos.originCommission') },
              { value: 'OVERRIDE', label: t('payroll.saldos.originOverride') },
            ]}
          />
          <FilterSelect
            label={t('payroll.saldos.campaignFilter')}
            value={campaignFilter}
            onChange={setCampaignFilter}
            options={[
              { value: '', label: lang === 'es' ? 'Todas' : 'All' },
              { value: 'D2D', label: 'D2D' },
              { value: 'RETAIL', label: 'Retail' },
            ]}
          />
        </div>
      </div>

      {/* Tiles */}
      <div className="grid grid-cols-3 gap-2">
        <Tile label={t('payroll.saldos.tileOriginal')} amount={totals.original} accent="gray" />
        <Tile label={t('payroll.saldos.tileCollected')} amount={totals.collected} accent="emerald" />
        <Tile label={t('payroll.saldos.tileRemaining')} amount={totals.remaining} accent={totals.remaining > 0 ? 'rose' : 'gray'} />
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-3 sm:px-5 py-3 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">{t('payroll.saldos.listTitle')}</h3>
          <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full px-2.5 py-0.5 font-semibold">
            {filtered.length}
          </span>
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
                  <th className="px-3 py-2 text-left">{t('payroll.saldos.colPerson')}</th>
                  <th className="px-3 py-2 text-left">{t('payroll.saldos.colStatus')}</th>
                  <th className="px-3 py-2 text-left">{t('payroll.saldos.colOrigin')}</th>
                  <th className="px-3 py-2 text-left">{t('payroll.saldos.colOriginWeek')}</th>
                  <th className="px-3 py-2 text-right">{t('payroll.saldos.colOriginal')}</th>
                  <th className="px-3 py-2 text-right">{t('payroll.saldos.colCollected')}</th>
                  <th className="px-3 py-2 text-right">{t('payroll.saldos.colRemaining')}</th>
                  <th className="px-3 py-2 text-left">{t('payroll.saldos.colState')}</th>
                  <th className="px-3 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="font-semibold text-gray-900 dark:text-gray-100">
                        {r.user?.name ?? r.user_id}
                      </div>
                      {r.user?.role && <div className="text-[10px] text-gray-400">{r.user.role}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <UserStatusBadge status={r.user?.payroll_status ?? 'active'} lang={lang} />
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-200">
                      {negativeBalanceOriginLabel(r.origin, lang)}
                    </td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 font-mono text-[10px]">
                      {r.origin_week}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700 dark:text-gray-200">
                      ${Number(r.original_amount).toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-700 dark:text-emerald-300">
                      ${Number(r.collected_amount).toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold">
                      <span className={Number(r.remaining_amount) > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-gray-500 dark:text-gray-400'}>
                        ${Number(r.remaining_amount).toFixed(2)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} lang={lang} />
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {r.status !== 'MANUALLY_DELETED' && r.status !== 'FULLY_COLLECTED' && (
                        <button
                          onClick={() => setDeleting(r)}
                          className="text-rose-600 dark:text-rose-400 hover:underline text-xs"
                        >
                          {t('common.delete')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {deleting && (
        <DeleteBalanceModal
          balance={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => { setDeleting(null); refresh(); }}
        />
      )}
    </div>
  );
}

// ── Delete modal (mandatory reason + ELIMINAR confirm) ──────────────────────

function DeleteBalanceModal({
  balance, onClose, onDeleted,
}: {
  balance: BalanceRow;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useLanguage();
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true); setError('');
    const r = await fetch(`/api/payroll/negative-balances/${balance.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, confirm }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error || t('common.error'));
      return;
    }
    onDeleted();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white dark:bg-gray-900 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h4 className="font-bold text-gray-800 dark:text-gray-100">{t('payroll.saldos.deleteTitle')}</h4>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-xl p-2.5 space-y-0.5">
            <p><span className="font-bold">{balance.user?.name ?? balance.user_id}</span></p>
            <p>{balance.description}</p>
            <p className="font-mono">${Number(balance.remaining_amount).toFixed(2)} {t('payroll.saldos.remainingHint')}</p>
          </div>
          <p className="text-xs text-rose-700 dark:text-rose-300">
            {t('payroll.saldos.deleteWarn')}
          </p>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('payroll.saldos.reason')} *</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('payroll.saldos.confirmType')}</label>
            <input
              type="text"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="ELIMINAR"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
          </div>
          {error && <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-sm">
              {t('common.cancel')}
            </button>
            <button
              onClick={submit}
              disabled={busy || reason.trim().length < 3 || confirm !== 'ELIMINAR'}
              className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm disabled:opacity-50"
            >
              {busy ? t('common.loading') : t('common.delete')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tiny presentational helpers ─────────────────────────────────────────────

function Tile({ label, amount, accent }: { label: string; amount: number; accent: string }) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    rose:    'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800',
    gray:    'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700',
  };
  return (
    <div className={`rounded-xl border px-3 py-2 ${colors[accent] ?? colors.gray}`}>
      <p className="text-lg font-extrabold leading-tight font-mono">${amount.toFixed(2)}</p>
      <p className="text-[10px] uppercase tracking-wide opacity-80 mt-0.5">{label}</p>
    </div>
  );
}

function StatusBadge({ status, lang }: { status: NegativeBalanceStatus; lang: 'es' | 'en' }) {
  const color =
    status === 'PENDING'              ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300' :
    status === 'PARTIALLY_COLLECTED'  ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
    status === 'FULLY_COLLECTED'      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
                                        'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>
      {negativeBalanceStatusLabel(status, lang)}
    </span>
  );
}

function UserStatusBadge({ status, lang }: { status: 'active' | 'inactive'; lang: 'es' | 'en' }) {
  const label = status === 'active'
    ? (lang === 'es' ? 'Activo' : 'Active')
    : (lang === 'es' ? 'Inactivo' : 'Inactive');
  const color = status === 'active'
    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
    : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>{label}</span>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
