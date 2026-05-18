'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/components/LanguageContext';
import {
  PLAN_TYPES, PLAN_CAMPAIGNS, D2D_TIERS, D2D_TERM_MONTHS,
  type PlanType, type PlanCampaign,
} from '@/lib/payroll/constants';
import { planTypeLabel, planCampaignLabel } from '@/lib/payroll/labels';
import type { PlanMapping } from '@/types/payroll';

interface PendingPlan { plan_name: string; sale_count: number; first_seen_at: string }

/**
 * Plan Mapping tab — block 03.
 *
 * Pre-seeded with the plans we found in the sample JE Commission files
 * (see 20260519 migration). Admin can add new mappings or tweak existing
 * ones; D2D COMMISSION rows need an `assigned_tier` before publication
 * (canPublishWeek() blocks otherwise).
 */
export default function PlanMappingTab({ onPendingCountChange }: { onPendingCountChange?: (n: number) => void }) {
  const { t, lang } = useLanguage();
  const [mappings, setMappings] = useState<PlanMapping[]>([]);
  const [pending, setPending] = useState<PendingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PlanMapping | null>(null);
  const [creating, setCreating] = useState(false);
  const [prefillName, setPrefillName] = useState<string>('');

  // Filters
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<PlanType | 'all'>('all');
  const [campaignFilter, setCampaignFilter] = useState<PlanCampaign | 'all'>('all');

  const fetchAll = useCallback(async () => {
    const [m, p] = await Promise.all([
      fetch('/api/payroll/plan-mappings').then((r) => r.ok ? r.json() : []),
      fetch('/api/payroll/plan-mappings?pending=1').then((r) => r.ok ? r.json() : []),
    ]);
    setMappings(m);
    setPending(p);
    setLoading(false);
    onPendingCountChange?.(p.length);
  }, [onPendingCountChange]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Returns the missing-data reason for a mapping, or null when it's complete.
  // D2D COMMISSION rows must have a tier; RCE adders need extra_amount. The rest
  // are considered fully specified once they exist as a row.
  const incompleteReason = (m: PlanMapping): 'tier' | 'extra' | null => {
    if (m.plan_type === 'COMMISSION' && m.campaign === 'D2D' && m.tier === null) return 'tier';
    if ((m.plan_type === 'RCE_ADDER_D2D' || m.plan_type === 'RCE_ADDER_RETAIL') && (m.extra_amount === null || m.extra_amount === undefined)) return 'extra';
    return null;
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = mappings.filter((m) => {
      if (typeFilter !== 'all' && m.plan_type !== typeFilter) return false;
      if (campaignFilter !== 'all' && m.campaign !== campaignFilter) return false;
      if (q && !m.plan_name.toLowerCase().includes(q)) return false;
      return true;
    });
    // Sort: incomplete rows first (so problematic mappings jump to the top),
    // then alphabetically by plan_name.
    return list.sort((a, b) => {
      const aIncomplete = incompleteReason(a) !== null;
      const bIncomplete = incompleteReason(b) !== null;
      if (aIncomplete !== bIncomplete) return aIncomplete ? -1 : 1;
      return a.plan_name.localeCompare(b.plan_name);
    });
  }, [mappings, search, typeFilter, campaignFilter]);

  // Tier-missing on COMMISSION D2D rows — a soft warning at the top of the
  // table since canPublishWeek() will block publishing until these are set.
  const d2dCommissionMissingTier = mappings.filter(
    (m) => m.plan_type === 'COMMISSION' && m.campaign === 'D2D' && m.tier === null,
  );

  if (loading) {
    return <div className="text-center py-20 text-gray-400">{t('common.loading')}</div>;
  }

  return (
    <div className="space-y-6">
      {/* ── Pending plans (no mapping yet) ────────────────────────────────── */}
      {pending.length > 0 && (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 p-3 sm:p-4">
          <p className="text-sm font-bold text-rose-800 dark:text-rose-200 mb-2">
            ⚠ {t('payroll.planMapping.pendingTitle')} ({pending.length})
          </p>
          <p className="text-xs text-rose-700 dark:text-rose-300 mb-3">{t('payroll.planMapping.pendingHint')}</p>
          <div className="space-y-1.5">
            {pending.map((p) => (
              <div key={p.plan_name} className="flex items-center justify-between gap-2 rounded-xl bg-white dark:bg-gray-900 border border-rose-200 dark:border-rose-800 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-mono font-semibold text-gray-900 dark:text-gray-100 truncate">{p.plan_name}</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {p.sale_count} {t('payroll.planMapping.pendingSales')}
                  </p>
                </div>
                <button
                  onClick={() => { setPrefillName(p.plan_name); setCreating(true); }}
                  className="text-xs font-semibold text-[var(--primary)] hover:underline whitespace-nowrap"
                >
                  {t('payroll.planMapping.mapNow')} →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── D2D COMMISSION missing tier soft warning ───────────────────────── */}
      {d2dCommissionMissingTier.length > 0 && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 sm:p-4">
          <p className="text-sm font-bold text-amber-800 dark:text-amber-200">
            ⚠ {t('payroll.planMapping.tierMissingTitle')} ({d2dCommissionMissingTier.length})
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">{t('payroll.planMapping.tierMissingHint')}</p>
        </div>
      )}

      {/* ── Filters + add button ───────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-3 sm:p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">
              {t('payroll.planMapping.searchLabel')}
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('payroll.planMapping.searchPlaceholder')}
              className="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>
          <FilterSelect
            label={t('payroll.planMapping.filterType')}
            value={typeFilter}
            onChange={(v) => setTypeFilter(v as PlanType | 'all')}
            options={[
              { value: 'all', label: lang === 'es' ? 'Todos' : 'All' },
              ...PLAN_TYPES.map((p) => ({ value: p, label: planTypeLabel(p, lang) })),
            ]}
          />
          <FilterSelect
            label={t('payroll.planMapping.filterCampaign')}
            value={campaignFilter}
            onChange={(v) => setCampaignFilter(v as PlanCampaign | 'all')}
            options={[
              { value: 'all', label: lang === 'es' ? 'Todas' : 'All' },
              ...PLAN_CAMPAIGNS.map((c) => ({ value: c, label: planCampaignLabel(c, lang) })),
            ]}
          />
          <button
            onClick={() => { setPrefillName(''); setCreating(true); }}
            className="px-3 py-1.5 rounded-lg text-white font-semibold text-xs"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            + {t('payroll.planMapping.addBtn')}
          </button>
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-3 sm:px-5 py-3 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">{t('payroll.planMapping.tableTitle')}</h3>
          <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full px-2.5 py-0.5 font-semibold">
            {filtered.length}{filtered.length !== mappings.length && <span className="text-gray-400"> / {mappings.length}</span>}
          </span>
        </div>
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('common.noData')}</div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {filtered.map((m) => {
              const incomplete = incompleteReason(m);
              return (
                <button
                  key={m.id}
                  onClick={() => setEditing(m)}
                  className={`w-full text-left grid grid-cols-12 gap-2 items-center px-3 sm:px-5 py-3 transition-colors ${
                    incomplete
                      ? 'bg-rose-50/40 dark:bg-rose-900/10 hover:bg-rose-50 dark:hover:bg-rose-900/20 border-l-2 border-rose-400 dark:border-rose-600'
                      : 'hover:bg-gray-50/50 dark:hover:bg-gray-800/30'
                  }`}
                >
                  <div className="col-span-12 sm:col-span-6 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-xs font-mono font-semibold text-gray-900 dark:text-gray-100 truncate">{m.plan_name}</p>
                      {incomplete && (
                        <span className="flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 ring-1 ring-rose-200 dark:ring-rose-800">
                          ⚠ {incomplete === 'tier' ? t('payroll.planMapping.tagMissingTier') : t('payroll.planMapping.tagMissingExtra')}
                        </span>
                      )}
                    </div>
                    {m.notes && <p className="text-[10px] text-gray-400 truncate mt-0.5">{m.notes}</p>}
                  </div>
                  <div className="col-span-4 sm:col-span-3">
                    <PlanTypeBadge type={m.plan_type} lang={lang} />
                  </div>
                  <div className="col-span-4 sm:col-span-2 text-[11px] text-gray-600 dark:text-gray-300">
                    {m.campaign ?? '—'}
                    {m.tier !== null && <> · T{m.tier}</>}
                    {m.term_months !== null && <> · {m.term_months}M</>}
                    {m.extra_amount !== null && <> · ${m.extra_amount.toFixed(0)}</>}
                  </div>
                  <div className="col-span-4 sm:col-span-1 text-[10px] text-gray-400 text-right">
                    {t('common.edit')}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {(editing || creating) && (
        <PlanMappingModal
          mapping={editing}
          prefillName={prefillName}
          onClose={() => { setEditing(null); setCreating(false); setPrefillName(''); }}
          onSaved={(reprocessed) => {
            setEditing(null); setCreating(false); setPrefillName('');
            fetchAll();
            if (reprocessed > 0) {
              alert(`${reprocessed} ${t('payroll.planMapping.reprocessedToast')}`);
            }
          }}
        />
      )}
    </div>
  );
}

function PlanTypeBadge({ type, lang }: { type: PlanType; lang: 'es' | 'en' }) {
  const color =
    type === 'COMMISSION'       ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
    type === 'RCE_ADDER_D2D'    ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' :
    type === 'RCE_ADDER_RETAIL' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' :
    type === 'RESIDUAL_D2D'     ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' :
    type === 'GREEN_BONUS'      ? 'bg-lime-100 dark:bg-lime-900/30 text-lime-700 dark:text-lime-300' :
    'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>
      {planTypeLabel(type, lang)}
    </span>
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

// ── Create / Edit modal ────────────────────────────────────────────────────
function PlanMappingModal({ mapping, prefillName, onClose, onSaved }: {
  mapping: PlanMapping | null;
  prefillName?: string;
  onClose: () => void;
  onSaved: (reprocessed: number) => void;
}) {
  const { t } = useLanguage();
  const isEdit = !!mapping;
  const [planName, setPlanName] = useState(mapping?.plan_name ?? prefillName ?? '');
  const [planType, setPlanType] = useState<PlanType>(mapping?.plan_type ?? 'COMMISSION');
  const [campaign, setCampaign] = useState<PlanCampaign | ''>(mapping?.campaign ?? '');
  const [tier, setTier] = useState<string>(mapping?.tier !== null && mapping?.tier !== undefined ? String(mapping.tier) : '');
  const [termMonths, setTermMonths] = useState<string>(mapping?.term_months !== null && mapping?.term_months !== undefined ? String(mapping.term_months) : '');
  const [extraAmount, setExtraAmount] = useState<string>(mapping?.extra_amount !== null && mapping?.extra_amount !== undefined ? String(mapping.extra_amount) : '');
  const [notes, setNotes] = useState(mapping?.notes ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const isCommissionD2D = planType === 'COMMISSION' && campaign === 'D2D';
  const isRceAdder = planType === 'RCE_ADDER_D2D' || planType === 'RCE_ADDER_RETAIL';

  async function handleSave() {
    setError(''); setSaving(true);
    const body = {
      ...(isEdit ? { id: mapping!.id } : { plan_name: planName.trim() }),
      plan_type: planType,
      campaign: campaign || null,
      tier: tier !== '' ? Number(tier) : null,
      term_months: termMonths !== '' ? Number(termMonths) : null,
      extra_amount: extraAmount !== '' ? Number(extraAmount) : null,
      notes: notes.trim() || null,
    };
    const res = await fetch('/api/payroll/plan-mappings', {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok) onSaved(j.reprocessed ?? 0);
    else setError(j.error || 'Error');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white dark:bg-gray-900 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h4 className="font-bold text-gray-800 dark:text-gray-100">
            {isEdit ? t('payroll.planMapping.editTitle') : t('payroll.planMapping.addTitle')}
          </h4>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-3">
          <Field label={t('payroll.planMapping.planName')}>
            <input
              type="text"
              value={planName}
              disabled={isEdit}
              onChange={(e) => setPlanName(e.target.value)}
              className={inputClass + ' font-mono text-xs disabled:opacity-60'}
              placeholder="Watts - Texas - ELE - D2D - 60 - ..."
            />
          </Field>
          <Field label={t('payroll.planMapping.type')}>
            <select value={planType} onChange={(e) => setPlanType(e.target.value as PlanType)} className={inputClass}>
              {PLAN_TYPES.map((p) => (<option key={p} value={p}>{p}</option>))}
            </select>
          </Field>
          <Field label={t('payroll.planMapping.campaign')}>
            <select value={campaign} onChange={(e) => setCampaign(e.target.value as PlanCampaign | '')} className={inputClass}>
              <option value="">N/A</option>
              {PLAN_CAMPAIGNS.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
          </Field>
          {isCommissionD2D && (
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('payroll.planMapping.tier')}>
                <select value={tier} onChange={(e) => setTier(e.target.value)} className={inputClass}>
                  <option value="">—</option>
                  {D2D_TIERS.map((n) => <option key={n} value={n}>Tier {n}</option>)}
                </select>
              </Field>
              <Field label={t('payroll.planMapping.term')}>
                <select value={termMonths} onChange={(e) => setTermMonths(e.target.value)} className={inputClass}>
                  <option value="">{t('payroll.planMapping.termFromFile')}</option>
                  {D2D_TERM_MONTHS.map((m) => <option key={m} value={m}>{m}M</option>)}
                  <option value="12">12M</option>
                </select>
              </Field>
            </div>
          )}
          {isRceAdder && (
            <Field label={t('payroll.planMapping.extraAmount')}>
              <input type="number" step="0.01" min="0" value={extraAmount} onChange={(e) => setExtraAmount(e.target.value)} className={inputClass} />
            </Field>
          )}
          <Field label={t('payroll.planMapping.notes')}>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputClass} />
          </Field>
          {error && <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-sm">
              {t('common.cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !planName.trim()}
              className="flex-1 py-2.5 rounded-xl text-white font-bold text-sm disabled:opacity-60"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
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
