'use client';
import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/components/LanguageContext';
import { payfileStateLabel } from '@/lib/payroll/labels';
import type { Payfile, PayfileVersion } from '@/types/payroll';
import type { PayfileState } from '@/lib/payroll/constants';

/**
 * Block 07 — Publicadas tab.
 *
 * Lists every payfile generated for a pay_week and exposes per-payfile
 * version history with snapshot / regenerate / download. The state
 * transition to PUBLISHED comes in block 11; for now admin can mint
 * versions here for QA.
 */

interface PublishedPayfile extends Payfile {
  user: { id: string; name: string; role: string | null } | null;
}
interface VersionDetail {
  payfile: Payfile;
  versions: Array<{
    id: string;
    version_number: number;
    published_at: string;
    published_by: string | null;
    published_by_name: string | null;
    pdf_path: string | null;
  }>;
  gate: {
    ok: boolean;
    pendingVerifyCount: number;
    pendingTierCount: number;
    pendingCeoApprovalCount: number;
    details: string[];
  };
}

export default function PublicadasTab() {
  const { t, lang } = useLanguage();
  const [weeks, setWeeks] = useState<string[]>([]);
  const [selectedWeek, setSelectedWeek] = useState('');
  const [payfiles, setPayfiles] = useState<PublishedPayfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Load weeks (we reuse the sales-week endpoint — same source of truth).
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
    if (r.ok) {
      const j = await r.json();
      setPayfiles(j.payfiles ?? []);
    }
    setLoading(false);
  }, []);
  useEffect(() => { if (selectedWeek) fetchPayfiles(selectedWeek); }, [selectedWeek, fetchPayfiles]);

  async function openDetail(id: string) {
    setOpenId(id);
    setDetail(null);
    const r = await fetch(`/api/payroll/payfiles/${id}/versions`);
    if (r.ok) setDetail(await r.json());
  }

  async function handleSnapshot(id: string) {
    if (!confirm(t('payroll.publicadas.confirmSnapshot'))) return;
    setBusy(id);
    const r = await fetch(`/api/payroll/payfiles/${id}/snapshot`, { method: 'POST' });
    setBusy(null);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.error || (j.gate?.details ?? []).join('\n') || t('common.error'));
      return;
    }
    fetchPayfiles(selectedWeek);
    if (openId === id) openDetail(id);
  }

  async function handleRegenerate(versionId: string) {
    setBusy(versionId);
    const r = await fetch(`/api/payroll/payfile-versions/${versionId}/regenerate`, { method: 'POST' });
    setBusy(null);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.error || t('common.error'));
      return;
    }
    if (openId) openDetail(openId);
  }

  async function handleDownload(payfileId: string, versionNumber?: number) {
    const url = versionNumber
      ? `/api/payroll/payfiles/${payfileId}/download?version=${versionNumber}`
      : `/api/payroll/payfiles/${payfileId}/download`;
    const r = await fetch(url);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.error || t('common.error'));
      return;
    }
    const j = await r.json();
    window.open(j.url, '_blank', 'noopener');
  }

  if (weeks.length === 0 && !loading) {
    return <div className="text-center py-16 text-gray-400 text-sm">{t('payroll.publicadas.empty')}</div>;
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
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-3 sm:px-5 py-3 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">{t('payroll.publicadas.listTitle')}</h3>
          <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full px-2.5 py-0.5 font-semibold">
            {payfiles.length}
          </span>
        </div>
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('common.loading')}</div>
        ) : payfiles.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('payroll.publicadas.noneForWeek')}</div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {payfiles.map((pf) => (
              <div key={pf.id}>
                <button
                  onClick={() => openId === pf.id ? setOpenId(null) : openDetail(pf.id)}
                  className="w-full text-left grid grid-cols-12 gap-2 items-center px-3 sm:px-5 py-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors"
                >
                  <div className="col-span-12 sm:col-span-5 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {pf.user?.name ?? pf.user_id}
                    </p>
                    {pf.user?.role && (
                      <p className="text-[10px] text-gray-400 mt-0.5">{pf.user.role}</p>
                    )}
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <StateBadge state={pf.state} lang={lang} />
                  </div>
                  <div className="col-span-4 sm:col-span-2 text-[11px] text-gray-600 dark:text-gray-300">
                    v{pf.last_version_number ?? 0}
                  </div>
                  <div className="col-span-4 sm:col-span-2 text-right font-mono text-sm font-bold text-gray-900 dark:text-gray-100">
                    ${Number(pf.total_amount).toFixed(2)}
                  </div>
                  <div className="col-span-12 sm:col-span-1 text-[10px] text-gray-400 sm:text-right">
                    {openId === pf.id ? '▾' : '▸'}
                  </div>
                </button>

                {openId === pf.id && detail && (
                  <div className="bg-gray-50/50 dark:bg-gray-800/30 border-t border-gray-100 dark:border-gray-700 px-3 sm:px-5 py-3 space-y-3">
                    {/* Gate banner */}
                    <Gate gate={detail.gate} t={t} />

                    <div className="flex items-center justify-between">
                      <p className="text-[10px] uppercase tracking-wide font-bold text-gray-500 dark:text-gray-400">
                        {t('payroll.publicadas.versionsTitle')}
                      </p>
                      <button
                        onClick={() => handleSnapshot(pf.id)}
                        disabled={!detail.gate.ok || busy === pf.id}
                        className="text-xs px-3 py-1 rounded-lg text-white font-semibold disabled:opacity-50"
                        style={{ backgroundColor: 'var(--primary)' }}
                      >
                        {busy === pf.id ? t('common.loading') : `+ ${t('payroll.publicadas.snapshot')}`}
                      </button>
                    </div>

                    {detail.versions.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">{t('payroll.publicadas.noVersions')}</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="text-gray-500 dark:text-gray-400">
                            <tr>
                              <th className="text-left px-2 py-1">{t('payroll.publicadas.colVersion')}</th>
                              <th className="text-left px-2 py-1">{t('payroll.publicadas.colDate')}</th>
                              <th className="text-left px-2 py-1">{t('payroll.publicadas.colBy')}</th>
                              <th className="text-left px-2 py-1">{t('payroll.publicadas.colPath')}</th>
                              <th className="text-right px-2 py-1"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.versions.map((v) => (
                              <tr key={v.id} className="border-t border-gray-100 dark:border-gray-700">
                                <td className="px-2 py-1 font-bold text-gray-700 dark:text-gray-200">v{v.version_number}</td>
                                <td className="px-2 py-1 text-gray-500 dark:text-gray-400">
                                  {new Date(v.published_at).toLocaleString(lang === 'es' ? 'es-MX' : 'en-US', {
                                    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                                  })}
                                </td>
                                <td className="px-2 py-1 text-gray-500 dark:text-gray-400">{v.published_by_name ?? '—'}</td>
                                <td className="px-2 py-1 text-gray-400 font-mono text-[10px] truncate max-w-[200px]" title={v.pdf_path ?? ''}>
                                  {v.pdf_path ?? '—'}
                                </td>
                                <td className="px-2 py-1 text-right whitespace-nowrap">
                                  <button onClick={() => handleDownload(pf.id, v.version_number)} className="text-[var(--primary)] hover:underline">
                                    {t('payroll.publicadas.download')}
                                  </button>
                                  {' · '}
                                  <button onClick={() => handleRegenerate(v.id)} disabled={busy === v.id} className="text-gray-600 dark:text-gray-300 hover:underline disabled:opacity-50">
                                    {busy === v.id ? '…' : t('payroll.publicadas.regenerate')}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Gate({
  gate, t,
}: {
  gate: VersionDetail['gate'];
  t: (k: string) => string;
}) {
  if (gate.ok) {
    return (
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200 px-3 py-2 text-xs">
        ✓ {t('payroll.publicadas.gateOk')}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 text-rose-800 dark:text-rose-200 px-3 py-2 text-xs space-y-1">
      <p className="font-bold">✗ {t('payroll.publicadas.gateBlocked')}</p>
      <ul className="ml-3 list-disc list-inside opacity-95">
        {gate.details.map((d, i) => <li key={i}>{d}</li>)}
      </ul>
    </div>
  );
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
