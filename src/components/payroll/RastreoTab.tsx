'use client';
import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageContext';
import { saleStatusLabel } from '@/lib/payroll/labels';
import { SALE_STATUSES, type SaleStatus, type RosterCampaign } from '@/lib/payroll/constants';
import type { PayrollSale } from '@/types/payroll';

/**
 * Block 14 — Payroll → Rastreo de Ventas tab (Admin/CEO only).
 *
 * Full sales-tracking table — every column from the JE upload plus the
 * payroll-system computed columns (resolved agent, 3-level manager chain,
 * pay_week, payfile_id, computed commission). Filters are combinable;
 * the search bar runs an ILIKE across contract_id, customer_name,
 * plan_name, je_badge and source_file_name.
 *
 * Click a row → side drawer with: full raw_row, resolved plan_mapping,
 * managers + amounts, line items in their respective payfiles, prior
 * appearances of the same contract_id (winback chain), audit log entries
 * tied to that sale.
 */

interface ManagerSlot { id: string; name: string | null; amount: number }
interface RastreoRow extends PayrollSale {
  agent_name: string | null;
  plan_mapping: {
    id: string; plan_name: string; plan_type: string;
    campaign: string | null; tier: number | null; term_months: number | null;
  } | null;
  managers: { MANAGER_1: ManagerSlot | null; MANAGER_2: ManagerSlot | null; MANAGER_3: ManagerSlot | null };
  agent_payfile_id: string | null;
  computed_commission: number | null;
}

interface ActorOption { id: string; name: string; role: string }

export default function RastreoTab() {
  const { t, lang } = useLanguage();
  const [rows, setRows] = useState<RastreoRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [openSaleId, setOpenSaleId] = useState<string | null>(null);
  const [users, setUsers] = useState<ActorOption[]>([]);
  const [weeks, setWeeks] = useState<string[]>([]);

  const [q, setQ] = useState('');
  const [contractId, setContractId] = useState('');
  const [customer, setCustomer] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [agentId, setAgentId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [campaign, setCampaign] = useState<RosterCampaign | ''>('');
  const [plan, setPlan] = useState('');
  const [status, setStatus] = useState<Set<SaleStatus>>(new Set());
  const [payWeek, setPayWeek] = useState('');
  const [sourceFile, setSourceFile] = useState('');
  const [isWinback, setIsWinback] = useState<'' | '1' | '0'>('');

  // Load actor/manager selector + week selector once.
  useEffect(() => {
    Promise.all([
      fetch('/api/users').then((r) => r.ok ? r.json() : []),
      fetch('/api/payroll/sales?weeks=1').then((r) => r.ok ? r.json() : []),
    ]).then(([u, w]) => {
      setUsers((u ?? []).map((x: { id: string; name: string; role: string }) => ({ id: x.id, name: x.name, role: x.role })));
      setWeeks(Array.isArray(w) ? w : []);
    });
  }, []);

  const buildParams = useCallback((overridePage?: number) => {
    const p = new URLSearchParams();
    p.set('rastreo', '1');
    p.set('page', String(overridePage ?? page));
    if (q.trim()) p.set('q', q.trim());
    if (contractId.trim()) p.set('contract_id', contractId.trim());
    if (customer.trim()) p.set('customer', customer.trim());
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (agentId) p.set('agent_id', agentId);
    if (managerId) p.set('manager_id', managerId);
    if (campaign) p.set('campaign', campaign);
    if (plan.trim()) p.set('plan', plan.trim());
    if (payWeek) p.set('pay_week', payWeek);
    if (sourceFile.trim()) p.set('source_file', sourceFile.trim());
    if (isWinback) p.set('is_winback', isWinback);
    if (status.size > 0) p.set('status', Array.from(status).join(','));
    return p;
  }, [q, contractId, customer, from, to, agentId, managerId, campaign, plan, payWeek, sourceFile, isWinback, status, page]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/payroll/sales?${buildParams().toString()}`);
    if (r.ok) {
      const j = await r.json();
      setRows(j.rows ?? []);
      setTotal(j.total ?? 0);
    }
    setLoading(false);
  }, [buildParams]);

  useEffect(() => { refresh(); }, [refresh]);

  const exportCsv = useCallback(() => {
    const params = buildParams();
    params.set('export', 'csv');
    window.location.href = `/api/payroll/sales?${params.toString()}`;
  }, [buildParams]);

  const toggleStatus = (s: SaleStatus) => {
    const next = new Set(status);
    if (next.has(s)) next.delete(s); else next.add(s);
    setStatus(next);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / 50));
  const managers = users.filter((u) => u.role === 'jr_manager' || u.role === 'sr_manager');
  const agents = users.filter((u) => u.role === 'agent');

  return (
    <div className="space-y-4">
      {/* Search + filters */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-3 sm:p-4 space-y-3">
        <input value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); refresh(); } }}
          placeholder={t('payroll.rastreo.searchPlaceholder')}
          className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:border-[var(--primary)] focus:outline-none" />

        <div className="flex flex-wrap gap-2 items-end">
          <FilterField label={t('payroll.rastreo.contract')}>
            <input value={contractId} onChange={(e) => setContractId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); refresh(); } }}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 w-[120px]" />
          </FilterField>
          <FilterField label={t('payroll.rastreo.customer')}>
            <input value={customer} onChange={(e) => setCustomer(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); refresh(); } }}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 w-[140px]" />
          </FilterField>
          <FilterField label={t('payroll.rastreo.from')}>
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100" />
          </FilterField>
          <FilterField label={t('payroll.rastreo.to')}>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100" />
          </FilterField>
          <FilterField label={t('payroll.rastreo.agent')}>
            <select value={agentId} onChange={(e) => { setAgentId(e.target.value); setPage(1); }}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 max-w-[140px]">
              <option value="">{lang === 'es' ? 'Todos' : 'All'}</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </FilterField>
          <FilterField label={t('payroll.rastreo.manager')}>
            <select value={managerId} onChange={(e) => { setManagerId(e.target.value); setPage(1); }}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 max-w-[140px]">
              <option value="">{lang === 'es' ? 'Todos' : 'All'}</option>
              {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </FilterField>
          <FilterField label={t('payroll.rastreo.campaign')}>
            <select value={campaign} onChange={(e) => { setCampaign(e.target.value as RosterCampaign | ''); setPage(1); }}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100">
              <option value="">{lang === 'es' ? 'Todas' : 'All'}</option>
              <option value="D2D">D2D</option>
              <option value="RETAIL">Retail</option>
            </select>
          </FilterField>
          <FilterField label={t('payroll.rastreo.plan')}>
            <input value={plan} onChange={(e) => setPlan(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); refresh(); } }}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 w-[120px]" />
          </FilterField>
          <FilterField label={t('payroll.rastreo.payWeek')}>
            <select value={payWeek} onChange={(e) => { setPayWeek(e.target.value); setPage(1); }}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100">
              <option value="">{lang === 'es' ? 'Todas' : 'All'}</option>
              {weeks.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </FilterField>
          <FilterField label={t('payroll.rastreo.sourceFile')}>
            <input value={sourceFile} onChange={(e) => setSourceFile(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); refresh(); } }}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 w-[160px]" />
          </FilterField>
          <FilterField label={t('payroll.rastreo.winback')}>
            <select value={isWinback} onChange={(e) => { setIsWinback(e.target.value as '' | '1' | '0'); setPage(1); }}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100">
              <option value="">{lang === 'es' ? 'Todas' : 'All'}</option>
              <option value="1">{lang === 'es' ? 'Solo Winback' : 'Winback only'}</option>
              <option value="0">{lang === 'es' ? 'No Winback' : 'Non-winback'}</option>
            </select>
          </FilterField>
          <button onClick={() => { setPage(1); refresh(); }}
            className="px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-semibold">
            {t('common.apply')}
          </button>
          <button onClick={exportCsv}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold">
            {t('payroll.rastreo.exportCsv')}
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 items-center pt-2 border-t border-gray-100 dark:border-gray-800">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('payroll.rastreo.status')}:</span>
          {SALE_STATUSES.map((s) => (
            <button key={s} onClick={() => toggleStatus(s)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                status.has(s)
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
              }`}>
              {saleStatusLabel(s, lang)}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-3 sm:px-5 py-3 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">{t('payroll.rastreo.title')}</h3>
          <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full px-2.5 py-0.5 font-semibold">{total}</span>
        </div>
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('common.loading')}</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('payroll.rastreo.empty')}</div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="overflow-x-auto hidden md:block">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('payroll.rastreo.colContract')}</th>
                    <th className="px-3 py-2 text-left">{t('payroll.rastreo.colCustomer')}</th>
                    <th className="px-3 py-2 text-left">{t('payroll.rastreo.colAgent')}</th>
                    <th className="px-3 py-2 text-left">M1</th>
                    <th className="px-3 py-2 text-left">M2</th>
                    <th className="px-3 py-2 text-left">M3</th>
                    <th className="px-3 py-2 text-left">{t('payroll.rastreo.colPlan')}</th>
                    <th className="px-3 py-2 text-center">{t('payroll.rastreo.colSigned')}</th>
                    <th className="px-3 py-2 text-center">{t('payroll.rastreo.colWeek')}</th>
                    <th className="px-3 py-2 text-center">{t('payroll.rastreo.colStatus')}</th>
                    <th className="px-3 py-2 text-right">{t('payroll.rastreo.colJe')}</th>
                    <th className="px-3 py-2 text-right">{t('payroll.rastreo.colPaid')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {rows.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 cursor-pointer"
                      onClick={() => setOpenSaleId(s.id)}>
                      <td className="px-3 py-2 font-mono text-[11px] text-gray-700 dark:text-gray-200 whitespace-nowrap">
                        {s.contract_id}
                        {s.is_winback && <span className="ml-1 text-violet-500" title="Winback">↺</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-200">{s.customer_name ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-200 whitespace-nowrap">
                        {s.agent_name ?? <span className="text-rose-500">— {s.je_badge}</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{s.managers.MANAGER_1?.name ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{s.managers.MANAGER_2?.name ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{s.managers.MANAGER_3?.name ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-300 max-w-[200px] truncate" title={s.plan_name}>{s.plan_name}</td>
                      <td className="px-3 py-2 text-center text-gray-500 dark:text-gray-400 font-mono text-[10px]">{s.contract_signed_date ?? '—'}</td>
                      <td className="px-3 py-2 text-center text-gray-500 dark:text-gray-400 font-mono text-[10px]">{s.pay_week ?? '—'}</td>
                      <td className="px-3 py-2 text-center">
                        <span className="inline-block bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 px-2 py-0.5 rounded-full text-[10px] font-bold">
                          {saleStatusLabel(s.status as SaleStatus, lang)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-gray-700 dark:text-gray-200 whitespace-nowrap">${Number(s.je_paid_amount).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-gray-700 dark:text-gray-200 whitespace-nowrap">
                        {s.computed_commission !== null ? `$${Number(s.computed_commission).toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-gray-50 dark:divide-gray-800">
              {rows.map((s) => (
                <button key={s.id} onClick={() => setOpenSaleId(s.id)} className="block w-full p-3 text-left hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-[11px] text-gray-700 dark:text-gray-200">{s.contract_id}{s.is_winback && <span className="ml-1 text-violet-500">↺</span>}</span>
                    <span className="text-[10px] font-mono text-gray-400">{s.pay_week ?? '—'}</span>
                  </div>
                  <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">{s.customer_name ?? '—'}</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{s.agent_name ?? `— ${s.je_badge}`} · {s.plan_name}</p>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="inline-block bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 px-2 py-0.5 rounded-full text-[10px] font-bold">
                      {saleStatusLabel(s.status as SaleStatus, lang)}
                    </span>
                    <span className="text-xs font-mono text-gray-700 dark:text-gray-200">${Number(s.je_paid_amount).toFixed(2)}</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="px-3 sm:px-5 py-3 border-t border-gray-50 dark:border-gray-800 flex items-center justify-between gap-2 text-xs">
              <span className="text-gray-500 dark:text-gray-400">{t('common.page')} {page} / {totalPages}</span>
              <div className="flex gap-1">
                <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40 font-semibold">←</button>
                <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="px-2.5 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40 font-semibold">→</button>
              </div>
            </div>
          </>
        )}
      </div>

      {openSaleId && <SaleDetailDrawer saleId={openSaleId} onClose={() => setOpenSaleId(null)} />}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">{label}</label>
      {children}
    </div>
  );
}

// ── Detail drawer ───────────────────────────────────────────────────────────

interface DetailPayload {
  sale: PayrollSale;
  plan_mapping: { id: string; plan_name: string; plan_type: string; tier: number | null; term_months: number | null; campaign: string | null; extra_amount: number | null } | null;
  agent: { id: string; name: string; username: string; role: string } | null;
  managers: Array<{ manager_level: string; manager_id: string; manager_name: string | null; amount: number; original_amount: number; payfile_line_item_id: string | null }>;
  line_items: Array<{ id: string; payfile_id: string; line_type: string; description: string; amount: number; original_amount: number; is_manually_edited: boolean; payfile: { id: string; owner_id: string; owner_name: string | null; pay_week: string; state: string } | null }>;
  chain: Array<{ id: string; contract_id: string; status: string; pay_week: string | null; je_paid_amount: number; contract_signed_date: string | null; source_file_name: string; is_winback: boolean }>;
  audit_entries: Array<{ id: string; created_at: string; action: string; change_notes: string | null; old_value: Record<string, unknown> | null; new_value: Record<string, unknown> | null }>;
}

function SaleDetailDrawer({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const { t, lang } = useLanguage();
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/payroll/sales/${saleId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { setData(j); setLoading(false); });
  }, [saleId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end" role="dialog" aria-modal="true">
      <button onClick={onClose} aria-label="Cerrar" className="absolute inset-0 bg-black/40" />
      <div className="relative w-full sm:max-w-2xl bg-white dark:bg-gray-900 shadow-xl overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-4 py-3 flex items-center justify-between">
          <h2 className="font-bold text-gray-900 dark:text-gray-100 text-sm">{t('payroll.rastreo.detailTitle')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xl leading-none">×</button>
        </div>
        {loading || !data ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('common.loading')}</div>
        ) : (
          <div className="p-4 space-y-5">
            {/* 1. JE raw */}
            <Section title={t('payroll.rastreo.detailRaw')}>
              <KV k="Contract ID" v={data.sale.contract_id} mono />
              <KV k="Customer" v={data.sale.customer_name ?? '—'} />
              <KV k="Plan" v={data.sale.plan_name} />
              <KV k="JE Badge" v={data.sale.je_badge} mono />
              <KV k="Marketing channel" v={data.sale.marketing_channel ?? '—'} />
              <KV k="JE disposition" v={data.sale.je_disposition ?? '—'} />
              <KV k="Signed date" v={data.sale.contract_signed_date ?? '—'} mono />
              <KV k="KWH/RCE" v={data.sale.kwh_or_rce ?? '—'} />
              <KV k="Commission type" v={data.sale.commission_type ?? '—'} />
              <KV k="JE paid amount" v={`$${Number(data.sale.je_paid_amount).toFixed(2)}`} />
              <KV k="Source file" v={data.sale.source_file_name} mono />
              <KV k="Raw term months" v={data.sale.raw_term_months ?? '—'} />
            </Section>

            {/* 2. System processing */}
            <Section title={t('payroll.rastreo.detailSystem')}>
              <KV k={t('payroll.rastreo.detailMapping')} v={data.plan_mapping
                ? `${data.plan_mapping.plan_name} · ${data.plan_mapping.plan_type}${data.plan_mapping.tier !== null ? ` · tier ${data.plan_mapping.tier}` : ''}${data.plan_mapping.term_months ? ` · ${data.plan_mapping.term_months}m` : ''}`
                : (lang === 'es' ? 'Sin mapeo (VERIFY)' : 'No mapping (VERIFY)')} />
              <KV k="Status" v={data.sale.status} />
              <KV k="Is winback" v={data.sale.is_winback ? '✓' : '—'} />
              <KV k="Assigned tier" v={data.sale.assigned_tier ?? '—'} />
              <KV k="Assigned term" v={data.sale.assigned_term_months ?? '—'} />
              <KV k={t('payroll.rastreo.detailPayWeek')} v={data.sale.pay_week ?? '—'} mono />
              {data.agent && <KV k={t('payroll.rastreo.detailAgent')} v={`${data.agent.name} (${data.agent.username})`} />}
              {data.managers.length > 0 ? (
                <div className="text-xs">
                  <p className="font-semibold text-gray-500 dark:text-gray-400 mt-2 mb-1">{t('payroll.rastreo.detailManagers')}</p>
                  {data.managers.map((m) => (
                    <div key={m.manager_level} className="flex justify-between py-0.5 text-gray-700 dark:text-gray-200">
                      <span>{m.manager_level} · {m.manager_name ?? '—'}</span>
                      <span className="font-mono">${Number(m.amount).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </Section>

            {/* 3. Line items / payment */}
            <Section title={t('payroll.rastreo.detailLineItems')}>
              {data.line_items.length === 0 ? (
                <p className="text-xs text-gray-400">{t('payroll.rastreo.detailNoLineItems')}</p>
              ) : (
                <div className="space-y-1.5">
                  {data.line_items.map((l) => (
                    <div key={l.id} className="text-xs flex items-center justify-between border border-gray-100 dark:border-gray-800 rounded-lg p-2">
                      <div>
                        <p className="text-gray-700 dark:text-gray-200 font-medium">{l.payfile?.owner_name ?? '—'} <span className="text-gray-400">· {l.line_type}</span></p>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 font-mono">{l.payfile?.pay_week ?? '—'} · {l.payfile?.state ?? '—'}</p>
                      </div>
                      <span className="font-mono text-gray-700 dark:text-gray-200">${Number(l.amount).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* 4. Chain (prior contract_id appearances) */}
            {data.chain.length > 0 && (
              <Section title={t('payroll.rastreo.detailChain')}>
                <div className="space-y-1.5">
                  {data.chain.map((c) => (
                    <div key={c.id} className="text-xs border border-gray-100 dark:border-gray-800 rounded-lg p-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400">{c.contract_signed_date ?? '—'}</span>
                        <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400">{c.status}{c.is_winback && ' · ↺'}</span>
                      </div>
                      <p className="text-[11px] text-gray-700 dark:text-gray-200">{c.source_file_name}</p>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* 5. Audit log */}
            {data.audit_entries.length > 0 && (
              <Section title={t('payroll.rastreo.detailAudit')}>
                <div className="space-y-1.5">
                  {data.audit_entries.map((a) => (
                    <div key={a.id} className="text-xs border border-gray-100 dark:border-gray-800 rounded-lg p-2">
                      <p className="text-[10px] font-mono text-gray-500 dark:text-gray-400">{new Date(a.created_at).toLocaleString()} · {a.action}</p>
                      <p className="text-[11px] text-gray-700 dark:text-gray-200">{a.change_notes ?? '—'}</p>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-bold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{title}</h3>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string | number; mono?: boolean }) {
  return (
    <div className="flex justify-between text-xs py-0.5">
      <span className="text-gray-500 dark:text-gray-400">{k}</span>
      <span className={`text-gray-800 dark:text-gray-100 ${mono ? 'font-mono text-[11px]' : ''}`}>{v}</span>
    </div>
  );
}
