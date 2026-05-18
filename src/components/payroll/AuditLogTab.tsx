'use client';
import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/components/LanguageContext';
import { AUDIT_ACTIONS, type AuditAction } from '@/lib/payroll/constants';

/**
 * Block 14 — Payroll → Audit Log tab (Admin/CEO only).
 *
 * Server-paginated table (50/page) with: date range, actor, entity_type
 * multi-select, action multi-select, entity_id exact, free-text query, and
 * CSV export. Expand a row to see the raw old/new JSON diff.
 *
 * The `entity_type` list is fixed — every code path that audits uses one
 * of these strings.
 */

const ENTITY_TYPES = [
  'payfile', 'payfile_line_item', 'payfile_override', 'payfile_version', 'payfile_calc',
  'plan_mapping', 'payroll_upload', 'payroll_sale',
  'company_bonus', 'bonus_distribution',
  'collection', 'negative_balance', 'residual',
  'roster_entry', 'roster_merge', 'custom_rate', 'user',
] as const;

interface AuditRow {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  entity_type: string;
  entity_id: string;
  action: AuditAction;
  description: string;
  change_notes: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
}

interface ActorOption { id: string; name: string }

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function weekAgoIso(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function AuditLogTab() {
  const { t, lang } = useLanguage();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [actors, setActors] = useState<ActorOption[]>([]);

  const [from, setFrom] = useState(weekAgoIso());
  const [to, setTo] = useState(todayIso());
  const [actorId, setActorId] = useState('');
  const [entityId, setEntityId] = useState('');
  const [q, setQ] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [selectedActions, setSelectedActions] = useState<Set<AuditAction>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);

  // Load actor list once.
  useEffect(() => {
    fetch('/api/users')
      .then((r) => r.ok ? r.json() : [])
      .then((users) => setActors((users ?? []).map((u: { id: string; name: string }) => ({ id: u.id, name: u.name }))));
  }, []);

  const buildParams = useCallback((overridePage?: number) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (actorId) params.set('actor_id', actorId);
    if (entityId.trim()) params.set('entity_id', entityId.trim());
    if (q.trim()) params.set('q', q.trim());
    if (selectedTypes.size > 0) params.set('entity_type', Array.from(selectedTypes).join(','));
    if (selectedActions.size > 0) params.set('action', Array.from(selectedActions).join(','));
    params.set('page', String(overridePage ?? page));
    params.set('lang', lang);
    return params;
  }, [from, to, actorId, entityId, q, selectedTypes, selectedActions, page, lang]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/payroll/audit-log?${buildParams().toString()}`);
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
    window.location.href = `/api/payroll/audit-log?${params.toString()}`;
  }, [buildParams]);

  const toggleType = (type: string) => {
    const next = new Set(selectedTypes);
    if (next.has(type)) next.delete(type); else next.add(type);
    setSelectedTypes(next);
    setPage(1);
  };
  const toggleAction = (action: AuditAction) => {
    const next = new Set(selectedActions);
    if (next.has(action)) next.delete(action); else next.add(action);
    setSelectedActions(next);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-3 sm:p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">{t('payroll.audit.from')}</label>
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">{t('payroll.audit.to')}</label>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">{t('payroll.audit.actor')}</label>
            <select value={actorId} onChange={(e) => { setActorId(e.target.value); setPage(1); }}
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 min-w-[160px]">
              <option value="">{lang === 'es' ? 'Todos' : 'All'}</option>
              {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">{t('payroll.audit.search')}</label>
            <input value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); refresh(); } }}
              placeholder={t('payroll.audit.searchPlaceholder')}
              className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">{t('payroll.audit.entityId')}</label>
            <input value={entityId} onChange={(e) => setEntityId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); refresh(); } }}
              placeholder="UUID"
              className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs font-mono text-gray-900 dark:text-gray-100 w-[180px]" />
          </div>
          <button onClick={() => { setPage(1); refresh(); }}
            className="px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-semibold">
            {t('common.apply')}
          </button>
          <button onClick={exportCsv}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold">
            {t('payroll.audit.exportCsv')}
          </button>
        </div>

        <div className="flex flex-wrap gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('payroll.audit.entityType')}:</span>
            {ENTITY_TYPES.map((tp) => (
              <button key={tp} onClick={() => toggleType(tp)}
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                  selectedTypes.has(tp)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
                }`}>
                {tp}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('payroll.audit.action')}:</span>
            {AUDIT_ACTIONS.map((a) => (
              <button key={a} onClick={() => toggleAction(a)}
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                  selectedActions.has(a)
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
                }`}>
                {a}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-3 sm:px-5 py-3 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">{t('payroll.audit.title')}</h3>
          <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full px-2.5 py-0.5 font-semibold">{total}</span>
        </div>
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('common.loading')}</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('payroll.audit.empty')}</div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="overflow-x-auto hidden md:block">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('payroll.audit.colWhen')}</th>
                    <th className="px-3 py-2 text-left">{t('payroll.audit.colActor')}</th>
                    <th className="px-3 py-2 text-left">{t('payroll.audit.colType')}</th>
                    <th className="px-3 py-2 text-left">{t('payroll.audit.colAction')}</th>
                    <th className="px-3 py-2 text-left">{t('payroll.audit.colDescription')}</th>
                    <th className="px-3 py-2 text-center w-12" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {rows.map((r) => (
                    <RowDesktop key={r.id} row={r} expanded={expanded === r.id}
                      onToggle={() => setExpanded(expanded === r.id ? null : r.id)} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-gray-50 dark:divide-gray-800">
              {rows.map((r) => (
                <RowMobile key={r.id} row={r} expanded={expanded === r.id}
                  onToggle={() => setExpanded(expanded === r.id ? null : r.id)} />
              ))}
            </div>

            {/* Pagination */}
            <div className="px-3 sm:px-5 py-3 border-t border-gray-50 dark:border-gray-800 flex items-center justify-between gap-2 text-xs">
              <span className="text-gray-500 dark:text-gray-400">
                {t('common.page')} {page} / {totalPages}
              </span>
              <div className="flex gap-1">
                <button disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40 font-semibold">
                  ←
                </button>
                <button disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="px-2.5 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40 font-semibold">
                  →
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function localDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function RowDesktop({ row, expanded, onToggle }: { row: AuditRow; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
        <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap font-mono text-[10px]">{localDate(row.created_at)}</td>
        <td className="px-3 py-2 text-gray-700 dark:text-gray-200 whitespace-nowrap">{row.actor_name ?? 'Sistema'}</td>
        <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap font-mono text-[10px]">{row.entity_type}</td>
        <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap font-mono text-[10px]">{row.action}</td>
        <td className="px-3 py-2 text-gray-700 dark:text-gray-200">{row.description}</td>
        <td className="px-3 py-2 text-center">
          <button onClick={onToggle} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xs font-bold">
            {expanded ? '−' : '+'}
          </button>
        </td>
      </tr>
      {expanded && <DiffRow row={row} />}
    </>
  );
}

function DiffRow({ row }: { row: AuditRow }) {
  return (
    <tr className="bg-gray-50/50 dark:bg-gray-800/30">
      <td colSpan={6} className="px-3 py-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
          <JsonBlock title="old_value" data={row.old_value} />
          <JsonBlock title="new_value" data={row.new_value} />
        </div>
        <div className="mt-2 text-[10px] text-gray-500 dark:text-gray-400 font-mono break-all">
          entity_id: {row.entity_id}
        </div>
      </td>
    </tr>
  );
}

function JsonBlock({ title, data }: { title: string; data: Record<string, unknown> | null }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{title}</div>
      <pre className="bg-gray-100 dark:bg-gray-900 rounded p-2 overflow-x-auto text-[10px] text-gray-700 dark:text-gray-200 max-h-64">
        {data ? JSON.stringify(data, null, 2) : '—'}
      </pre>
    </div>
  );
}

function RowMobile({ row, expanded, onToggle }: { row: AuditRow; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="p-3">
      <button onClick={onToggle} className="w-full text-left">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400">{localDate(row.created_at)}</span>
          <span className="text-[10px] font-mono text-gray-400">{row.entity_type} · {row.action}</span>
        </div>
        <p className="text-xs text-gray-700 dark:text-gray-200">{row.description}</p>
      </button>
      {expanded && (
        <div className="mt-3 grid gap-2">
          <JsonBlock title="old_value" data={row.old_value} />
          <JsonBlock title="new_value" data={row.new_value} />
          <div className="text-[10px] text-gray-500 dark:text-gray-400 font-mono break-all">
            entity_id: {row.entity_id}
          </div>
        </div>
      )}
    </div>
  );
}
