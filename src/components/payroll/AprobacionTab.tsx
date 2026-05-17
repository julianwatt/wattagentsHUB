'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Session } from 'next-auth';
import { useLanguage } from '@/components/LanguageContext';
import { payfileLineTypeLabel, payfileStateLabel } from '@/lib/payroll/labels';
import type { PayfileLineItem, PayfileOverride, Payfile } from '@/types/payroll';
import type { PayfileLineType, PayfileState } from '@/lib/payroll/constants';
import { OVER_RECEIVED_MULTIPLE } from '@/lib/payroll/constants';

/**
 * Block 11 — Aprobación tab.
 *
 * CEO-first view of payfiles in PENDING_APPROVAL state grouped by pay_week.
 * Admin sees the same list (read-only) so they know what's in flight.
 * Includes the per-line >3× approve action and a reject modal with
 * mandatory notes.
 */

interface UserSlice { id: string; name: string; role: string | null }
interface PayfileWithItems extends Payfile {
  user: UserSlice | null;
  line_items: PayfileLineItem[];
  overrides: PayfileOverride[];
}
interface FetchResult { pay_week: string; payfiles: PayfileWithItems[] }

interface Props { session: Session }

export default function AprobacionTab({ session }: Props) {
  const { t, lang } = useLanguage();
  const [weeks, setWeeks] = useState<string[]>([]);
  const [selectedWeek, setSelectedWeek] = useState('');
  const [payfiles, setPayfiles] = useState<PayfileWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PayfileWithItems | null>(null);

  const role = session.user.role ?? '';
  const isCeo = role === 'ceo';

  // Distinct pay_weeks across the whole system (re-uses the sales weeks endpoint).
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

  const refresh = useCallback(async (week: string) => {
    if (!week) return;
    setLoading(true);
    const r = await fetch(`/api/payroll/payfiles?pay_week=${encodeURIComponent(week)}`);
    if (r.ok) {
      const j: FetchResult = await r.json();
      // Keep only PENDING_APPROVAL.
      setPayfiles((j.payfiles ?? []).filter((p) => p.state === 'PENDING_APPROVAL'));
    }
    setLoading(false);
  }, []);
  useEffect(() => { if (selectedWeek) refresh(selectedWeek); }, [selectedWeek, refresh]);

  const summary = useMemo(() => {
    let total = 0; let editedLines = 0; let over3xPending = 0;
    for (const pf of payfiles) {
      total += Number(pf.total_amount);
      for (const li of pf.line_items) {
        if (li.is_manually_edited) editedLines += 1;
        if (li.requires_ceo_approval) over3xPending += 1;
      }
    }
    return { total, editedLines, over3xPending };
  }, [payfiles]);

  async function approve(pf: PayfileWithItems) {
    if (!confirm(t('payroll.aprobacion.confirmApprove'))) return;
    setBusy(pf.id);
    const r = await fetch(`/api/payroll/payfiles/${pf.id}/approve`, { method: 'POST' });
    setBusy(null);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.error || (j.gate?.details ?? []).join('\n') || t('common.error'));
      return;
    }
    refresh(selectedWeek);
  }
  async function approveAll() {
    if (!confirm(t('payroll.aprobacion.confirmApproveAll'))) return;
    for (const pf of payfiles) {
      setBusy(pf.id);
      const r = await fetch(`/api/payroll/payfiles/${pf.id}/approve`, { method: 'POST' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(`${pf.user?.name ?? pf.id}: ${j.error || t('common.error')}`);
      }
    }
    setBusy(null);
    refresh(selectedWeek);
  }
  async function approve3xLine(lineItemId: string, pf: PayfileWithItems) {
    setBusy(pf.id);
    const r = await fetch(`/api/payroll/payfile-line-items/${lineItemId}/approve-3x`, { method: 'POST' });
    setBusy(null);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.error || t('common.error'));
      return;
    }
    refresh(selectedWeek);
  }

  if (!isCeo && payfiles.length === 0 && !loading) {
    // Admin lurking + nothing in flight: friendly empty state.
    return (
      <div className="text-center py-16 text-gray-400 text-sm">
        {t('payroll.aprobacion.empty')}
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
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
          >
            {weeks.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <button
          onClick={() => selectedWeek && refresh(selectedWeek)}
          className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-xs"
        >
          {t('common.refresh')}
        </button>
        {isCeo && payfiles.length > 0 && (
          <button
            onClick={approveAll}
            disabled={busy !== null || summary.over3xPending > 0}
            title={summary.over3xPending > 0 ? t('payroll.aprobacion.over3xBlocks') : ''}
            className="ml-auto px-4 py-2 rounded-xl text-white font-bold text-sm disabled:opacity-50"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            {t('payroll.aprobacion.approveAll')}
          </button>
        )}
      </div>

      {/* Summary tiles */}
      {payfiles.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Tile label={t('payroll.aprobacion.payfileCount')} value={String(payfiles.length)} accent="sky" />
          <Tile label={t('payroll.aprobacion.weekTotal')} value={`$${summary.total.toFixed(2)}`} accent="emerald" />
          <Tile label={t('payroll.aprobacion.editedLines')} value={String(summary.editedLines)} accent="indigo" />
          <Tile label={t('payroll.aprobacion.over3xPending')} value={String(summary.over3xPending)} accent={summary.over3xPending > 0 ? 'rose' : 'gray'} />
        </div>
      )}

      {/* Payfile list */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-3 sm:px-5 py-3 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">{t('payroll.aprobacion.listTitle')}</h3>
          <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full px-2.5 py-0.5 font-semibold">{payfiles.length}</span>
        </div>
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('common.loading')}</div>
        ) : payfiles.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('payroll.aprobacion.noPending')}</div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {payfiles.map((pf) => {
              const editedHere = pf.line_items.filter((li) => li.is_manually_edited).length;
              const over3xHere = pf.line_items.filter((li) => li.requires_ceo_approval).length;
              return (
                <div key={pf.id}>
                  <button
                    onClick={() => {
                      const n = new Set(expanded);
                      if (n.has(pf.id)) n.delete(pf.id); else n.add(pf.id);
                      setExpanded(n);
                    }}
                    className="w-full text-left grid grid-cols-12 gap-2 items-center px-3 sm:px-5 py-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors"
                  >
                    <div className="col-span-12 sm:col-span-5 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{pf.user?.name ?? pf.user_id}</p>
                      {pf.user?.role && <p className="text-[10px] text-gray-400 mt-0.5">{pf.user.role}</p>}
                    </div>
                    <div className="col-span-4 sm:col-span-2 text-[11px]">
                      <StateBadge state={pf.state} lang={lang} />
                    </div>
                    <div className="col-span-4 sm:col-span-2 text-[11px] text-gray-600 dark:text-gray-300">
                      {editedHere > 0 && <span className="inline-block bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded text-[9px] font-bold mr-1">EDIT {editedHere}</span>}
                      {over3xHere > 0 && <span className="inline-block bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 px-1.5 py-0.5 rounded text-[9px] font-bold">3× {over3xHere}</span>}
                    </div>
                    <div className="col-span-4 sm:col-span-2 text-right font-mono text-sm font-bold text-gray-900 dark:text-gray-100">${Number(pf.total_amount).toFixed(2)}</div>
                    <div className="col-span-12 sm:col-span-1 text-[10px] text-gray-400 sm:text-right">{expanded.has(pf.id) ? '▾' : '▸'}</div>
                  </button>

                  {expanded.has(pf.id) && (
                    <div className="bg-gray-50/50 dark:bg-gray-800/30 border-t border-gray-100 dark:border-gray-700 px-3 sm:px-5 py-3 space-y-3">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="text-gray-500 dark:text-gray-400">
                            <tr>
                              <th className="text-left px-2 py-1">{t('payroll.payfiles.colType')}</th>
                              <th className="text-left px-2 py-1">{t('payroll.payfiles.colDescription')}</th>
                              <th className="text-right px-2 py-1">{t('payroll.payfiles.colAmount')}</th>
                              <th className="text-center px-2 py-1">{t('payroll.payfiles.colFlags')}</th>
                              <th className="text-right px-2 py-1"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {pf.line_items.map((li) => (
                              <tr key={li.id} className={`border-t border-gray-100 dark:border-gray-700 ${li.requires_ceo_approval ? 'bg-rose-50/40 dark:bg-rose-900/10' : ''}`}>
                                <td className="px-2 py-1">
                                  <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                                    {payfileLineTypeLabel(li.line_type as PayfileLineType, lang).toUpperCase()}
                                  </span>
                                </td>
                                <td className="px-2 py-1 max-w-[280px] truncate text-gray-700 dark:text-gray-200" title={li.description}>{li.description}</td>
                                <td className="px-2 py-1 text-right font-mono font-bold">${Number(li.amount).toFixed(2)}</td>
                                <td className="px-2 py-1 text-center">
                                  {li.is_manually_edited && <Flag color="indigo" label="EDIT" />}
                                  {li.is_over_3x_received && <Flag color="rose" label={`>${OVER_RECEIVED_MULTIPLE}x`} />}
                                  {li.requires_ceo_approval && <Flag color="rose" label="REQ CEO" />}
                                </td>
                                <td className="px-2 py-1 text-right">
                                  {isCeo && li.requires_ceo_approval && (
                                    <button
                                      onClick={() => approve3xLine(li.id, pf)}
                                      disabled={busy === pf.id}
                                      className="text-xs px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50"
                                    >
                                      {t('payroll.aprobacion.approve3x')}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {isCeo && (
                        <div className="flex flex-wrap gap-2 pt-2">
                          <button
                            onClick={() => approve(pf)}
                            disabled={busy === pf.id || pf.line_items.some((li) => li.requires_ceo_approval)}
                            title={pf.line_items.some((li) => li.requires_ceo_approval) ? t('payroll.aprobacion.over3xBlocks') : ''}
                            className="px-3 py-1.5 rounded-lg text-white font-bold text-xs disabled:opacity-50"
                            style={{ backgroundColor: 'var(--primary)' }}
                          >
                            {busy === pf.id ? t('common.loading') : t('payroll.aprobacion.approveAndPublish')}
                          </button>
                          <button
                            onClick={() => setRejecting(pf)}
                            disabled={busy === pf.id}
                            className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs disabled:opacity-50"
                          >
                            {t('payroll.aprobacion.reject')}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {rejecting && (
        <RejectModal
          payfile={rejecting}
          onClose={() => setRejecting(null)}
          onRejected={() => { setRejecting(null); refresh(selectedWeek); }}
        />
      )}
    </div>
  );
}

function RejectModal({ payfile, onClose, onRejected }: { payfile: PayfileWithItems; onClose: () => void; onRejected: () => void }) {
  const { t } = useLanguage();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true); setError('');
    const r = await fetch(`/api/payroll/payfiles/${payfile.id}/reject`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error || t('common.error'));
      return;
    }
    onRejected();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white dark:bg-gray-900 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h4 className="font-bold text-gray-800 dark:text-gray-100">{t('payroll.aprobacion.rejectTitle')}</h4>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="rounded-xl bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs text-gray-700 dark:text-gray-200">
            <span className="font-bold">{payfile.user?.name ?? payfile.user_id}</span> · ${Number(payfile.total_amount).toFixed(2)}
          </div>
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400">{t('payroll.aprobacion.rejectNotes')} *</label>
          <textarea
            value={notes} onChange={(e) => setNotes(e.target.value)} rows={4}
            placeholder={t('payroll.aprobacion.rejectNotesPlaceholder')}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-sm">{t('common.cancel')}</button>
            <button onClick={submit} disabled={busy || notes.trim().length < 1} className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm disabled:opacity-50">
              {busy ? t('common.loading') : t('payroll.aprobacion.reject')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent: string }) {
  const colors: Record<string, string> = {
    sky:     'bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800',
    emerald: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    indigo:  'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
    rose:    'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800',
    gray:    'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700',
  };
  return (
    <div className={`rounded-xl border px-3 py-2 ${colors[accent] ?? colors.gray}`}>
      <p className="text-lg font-extrabold leading-tight">{value}</p>
      <p className="text-[10px] uppercase tracking-wide opacity-80 mt-0.5">{label}</p>
    </div>
  );
}

function Flag({ color, label }: { color: string; label: string }) {
  const colors: Record<string, string> = {
    indigo: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',
    rose:   'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300',
  };
  return <span className={`inline-block ml-0.5 px-1 py-0.5 rounded text-[8.5px] font-bold ${colors[color]}`}>{label}</span>;
}

function StateBadge({ state, lang }: { state: PayfileState; lang: 'es' | 'en' }) {
  const color =
    state === 'DRAFT'            ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200' :
    state === 'PENDING_APPROVAL' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
    state === 'APPROVED'         ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
    state === 'PUBLISHED'        ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
                                   'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>
      {payfileStateLabel(state, lang)}
    </span>
  );
}
