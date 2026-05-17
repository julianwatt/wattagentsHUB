'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Session } from 'next-auth';
import { useLanguage } from '@/components/LanguageContext';
import type { PayrollRosterEntry, RosterCustomRate } from '@/types/payroll';
import type {
  RosterPosition, RosterCampaign, ManagerLevel,
} from '@/lib/payroll/constants';
import {
  ROSTER_POSITIONS, ROSTER_CAMPAIGNS, D2D_TERM_MONTHS,
} from '@/lib/payroll/constants';
import { rosterCampaignLabel, rosterPositionLabel } from '@/lib/payroll/labels';

// ── Types ────────────────────────────────────────────────────────────────────
type UserRole = 'agent' | 'jr_manager' | 'sr_manager' | 'admin' | 'ceo';
type Modality = 'd2d' | 'retail' | 'both';
type PayrollStatus = 'active' | 'inactive';

interface RosterRow {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  manager_id: string | null;
  modality: Modality;
  payroll_status: PayrollStatus;
  is_active: boolean;
  hire_date: string;
  badges: PayrollRosterEntry[];
  custom_rates: RosterCustomRate[];
}

interface BadgeAlert {
  id: string;
  je_badge: string;
  first_seen_at: string;
  last_seen_at: string;
  sale_count: number;
  resolved_at: string | null;
}

interface PreviewSale { id: string; contract_id: string; pay_week: string | null }
interface PreviewBadge { id: string; je_badge: string; je_badge_status: string; campaign: string; position: string }
interface PreviewPayfile { id: string; pay_week: string; state: string; total_amount: number }
interface PreviewNegative { id: string; status: string; remaining_amount: number; origin_week: string }
interface MergePreview {
  source: { id: string; name: string; username: string };
  destination: { id: string; name: string; username: string };
  badges_to_move: PreviewBadge[];
  past_payfiles_preserved: PreviewPayfile[];
  negative_balances_preserved: PreviewNegative[];
  future_sales_repointed: PreviewSale[];
}

// ── Main component ───────────────────────────────────────────────────────────
export default function RosterTab(_props: { session: Session }) {
  void _props.session;
  const { t, lang } = useLanguage();
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [alerts, setAlerts] = useState<BadgeAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [mergeMode, setMergeMode] = useState<{ source_id: string; destination_id: string } | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [positionFilter, setPositionFilter] = useState<RosterPosition | 'all'>('all');
  const [campaignFilter, setCampaignFilter] = useState<Modality | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<PayrollStatus | 'all'>('all');
  const [managerFilter, setManagerFilter] = useState<string | 'all'>('all');

  const fetchAll = useCallback(async () => {
    const [r, a] = await Promise.all([
      fetch('/api/payroll/roster').then((res) => res.ok ? res.json() : []),
      fetch('/api/payroll/badge-alerts').then((res) => res.ok ? res.json() : []),
    ]);
    setRows(r);
    setAlerts(a);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Build the manager lookup for the "Manager" column.
  const userById = useMemo(() => {
    const m = new Map<string, RosterRow>();
    for (const u of rows) m.set(u.id, u);
    return m;
  }, [rows]);

  // Apply filters
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((u) => {
      // The Roster tab only shows people that participate in payroll.
      // Admin is excluded (master plan §Roles); CEO is also excluded
      // because their pay is utility-based outside the payfile system.
      if (u.role === 'admin' || u.role === 'ceo') return false;
      if (positionFilter !== 'all' && u.role !== positionFilter) return false;
      if (campaignFilter !== 'all' && u.modality !== campaignFilter) return false;
      if (statusFilter !== 'all' && u.payroll_status !== statusFilter) return false;
      if (managerFilter !== 'all' && u.manager_id !== managerFilter) return false;
      if (q) {
        const hay = `${u.name} ${u.username} ${u.badges.map((b) => b.je_badge).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, positionFilter, campaignFilter, statusFilter, managerFilter]);

  const selectedUser = selectedUserId ? userById.get(selectedUserId) ?? null : null;
  const managers = rows.filter((u) => u.role === 'jr_manager' || u.role === 'sr_manager');

  if (loading) {
    return <div className="text-center py-20 text-gray-400">{t('common.loading')}</div>;
  }

  return (
    <div className="space-y-6">
      {/* ── Badge alerts banner ─────────────────────────────────────────────── */}
      {alerts.length > 0 && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 sm:p-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <p className="text-sm font-bold text-amber-800 dark:text-amber-200">
                ⚠ {t('payroll.roster.alertsTitle')} ({alerts.length})
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">{t('payroll.roster.alertsHint')}</p>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {alerts.map((a) => (
              <div key={a.id} className="rounded-xl bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs">
                <p className="font-mono font-bold text-gray-900 dark:text-gray-100">{a.je_badge}</p>
                <p className="text-gray-500 dark:text-gray-400 mt-0.5">
                  {a.sale_count} {t('payroll.roster.alertsSales')} · {fmtDate(a.last_seen_at, lang)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Filters bar ─────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-3 sm:p-4 space-y-3">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('payroll.roster.searchPlaceholder')}
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] placeholder-gray-400"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterSelect
            label={t('payroll.roster.filterPosition')}
            value={positionFilter}
            onChange={(v) => setPositionFilter(v as RosterPosition | 'all')}
            options={[
              { value: 'all', label: lang === 'es' ? 'Todas' : 'All' },
              ...ROSTER_POSITIONS.map((p) => ({ value: p, label: rosterPositionLabel(p, lang) })),
            ]}
          />
          <FilterSelect
            label={t('payroll.roster.filterCampaign')}
            value={campaignFilter}
            onChange={(v) => setCampaignFilter(v as Modality | 'all')}
            options={[
              { value: 'all', label: lang === 'es' ? 'Todas' : 'All' },
              { value: 'd2d', label: 'D2D' },
              { value: 'retail', label: 'Retail' },
              { value: 'both', label: lang === 'es' ? 'Ambas' : 'Both' },
            ]}
          />
          <FilterSelect
            label={t('payroll.roster.filterStatus')}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as PayrollStatus | 'all')}
            options={[
              { value: 'all', label: lang === 'es' ? 'Todos' : 'All' },
              { value: 'active', label: lang === 'es' ? 'Activo' : 'Active' },
              { value: 'inactive', label: lang === 'es' ? 'Inactivo' : 'Inactive' },
            ]}
          />
          <FilterSelect
            label={t('payroll.roster.filterManager')}
            value={managerFilter}
            onChange={setManagerFilter}
            options={[
              { value: 'all', label: lang === 'es' ? 'Todos' : 'All' },
              ...managers.map((m) => ({ value: m.id, label: m.name })),
            ]}
          />
        </div>
      </div>

      {/* ── Roster table / cards ────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-3 sm:px-5 py-3 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">{t('payroll.roster.tableTitle')}</h3>
          <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full px-2.5 py-0.5 font-semibold">
            {filtered.length}
            {filtered.length !== rows.length && <span className="text-gray-400"> / {rows.length}</span>}
          </span>
        </div>
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">{t('common.noData')}</div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {filtered.map((u) => (
              <RosterRowItem
                key={u.id}
                user={u}
                manager={u.manager_id ? userById.get(u.manager_id) ?? null : null}
                onSelect={() => setSelectedUserId(u.id)}
                lang={lang}
                t={t}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Detail panel ────────────────────────────────────────────────────── */}
      {selectedUser && (
        <RosterDetailPanel
          user={selectedUser}
          allUsers={rows}
          onClose={() => setSelectedUserId(null)}
          onSaved={() => fetchAll()}
          onStartMerge={(dst) => setMergeMode({ source_id: selectedUser.id, destination_id: dst })}
        />
      )}

      {/* ── Merge flow ──────────────────────────────────────────────────────── */}
      {mergeMode && (
        <MergeFlow
          sourceId={mergeMode.source_id}
          destinationId={mergeMode.destination_id}
          onClose={() => setMergeMode(null)}
          onDone={() => { setMergeMode(null); setSelectedUserId(null); fetchAll(); }}
        />
      )}
    </div>
  );
}

// ── Filter dropdown ────────────────────────────────────────────────────────
function FilterSelect({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block mt-0.5 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

// ── Roster row ─────────────────────────────────────────────────────────────
function RosterRowItem({ user, manager, onSelect, lang, t }: {
  user: RosterRow;
  manager: RosterRow | null;
  onSelect: () => void;
  lang: 'es' | 'en';
  t: (k: string) => string;
}) {
  const activeBadges = user.badges.filter((b) => b.je_badge_status === 'active');
  return (
    <button
      onClick={onSelect}
      className="w-full text-left flex items-center justify-between gap-2 px-3 sm:px-5 py-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors"
    >
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 ${user.payroll_status === 'inactive' ? 'opacity-40' : ''}`}
          style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className={`font-semibold text-xs sm:text-sm truncate ${user.payroll_status === 'inactive' ? 'text-gray-400' : 'text-gray-800 dark:text-gray-100'}`}>{user.name}</p>
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            <span className="text-[10px] text-gray-500 dark:text-gray-400">{rosterPositionLabel(user.role as RosterPosition, lang)}</span>
            <span className="text-gray-300">·</span>
            <span className="text-[10px] text-gray-500 dark:text-gray-400">{campaignLabel(user.modality, lang)}</span>
            {manager && (<>
              <span className="text-gray-300">·</span>
              <span className="text-[10px] text-gray-500 dark:text-gray-400">{t('payroll.roster.managerCol')}: {manager.name}</span>
            </>)}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {activeBadges.length > 0 && (
          <span className="text-[10px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full px-2 py-0.5">
            {activeBadges.length === 1 ? activeBadges[0].je_badge : `${activeBadges.length} ${t('payroll.roster.badgesShort')}`}
          </span>
        )}
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${user.payroll_status === 'active' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}`}>
          {user.payroll_status === 'active' ? (lang === 'es' ? 'Activo' : 'Active') : (lang === 'es' ? 'Inactivo' : 'Inactive')}
        </span>
      </div>
    </button>
  );
}

// ── Detail panel (modal-ish slide-up) ──────────────────────────────────────
function RosterDetailPanel({ user, allUsers, onClose, onSaved, onStartMerge }: {
  user: RosterRow;
  allUsers: RosterRow[];
  onClose: () => void;
  onSaved: () => void;
  onStartMerge: (destinationId: string) => void;
}) {
  const { t, lang } = useLanguage();
  const [showBadgeModal, setShowBadgeModal] = useState(false);
  const [showRateModal, setShowRateModal] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');
  const [inactivating, setInactivating] = useState<string | null>(null);
  const [deletingRate, setDeletingRate] = useState<string | null>(null);

  const activeBadges = user.badges.filter((b) => b.je_badge_status === 'active');
  const inactiveBadges = user.badges.filter((b) => b.je_badge_status !== 'active');

  async function handleInactivateBadge(badgeId: string) {
    if (!confirm(t('payroll.roster.confirmInactivateBadge'))) return;
    setInactivating(badgeId);
    await fetch('/api/payroll/roster/badges', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: badgeId, je_badge_status: 'inactive' }),
    });
    setInactivating(null);
    onSaved();
  }

  async function handleDeleteRate(rateId: string) {
    if (!confirm(t('payroll.roster.confirmDeleteRate'))) return;
    setDeletingRate(rateId);
    await fetch('/api/payroll/roster/custom-rates', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rateId }),
    });
    setDeletingRate(null);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white dark:bg-gray-900 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-800 dark:text-gray-100">{user.name}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">@{user.username} · {rosterPositionLabel(user.role as RosterPosition, lang)} · {campaignLabel(user.modality, lang)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-5">
          {/* JE Badges */}
          <Section
            title={t('payroll.roster.badgesTitle')}
            action={
              <button onClick={() => setShowBadgeModal(true)} className="text-xs font-semibold text-[var(--primary)] hover:underline">
                + {t('payroll.roster.addBadge')}
              </button>
            }
          >
            {activeBadges.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">{t('payroll.roster.noActiveBadges')}</p>
            ) : (
              <div className="space-y-1.5">
                {activeBadges.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-mono font-bold text-gray-900 dark:text-gray-100">{b.je_badge}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {rosterCampaignLabel(b.campaign as RosterCampaign, lang)} · {rosterPositionLabel(b.position as RosterPosition, lang)} · {fmtDate(b.valid_from, lang)}{b.valid_until ? ` → ${fmtDate(b.valid_until, lang)}` : ''}
                      </p>
                    </div>
                    <button
                      disabled={inactivating === b.id}
                      onClick={() => handleInactivateBadge(b.id)}
                      className="text-[11px] font-semibold text-amber-700 hover:underline disabled:opacity-50"
                    >
                      {t('payroll.roster.inactivateBadge')}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {inactiveBadges.length > 0 && (
              <details className="mt-2">
                <summary className="text-[11px] text-gray-400 cursor-pointer">{t('payroll.roster.showInactiveBadges')} ({inactiveBadges.length})</summary>
                <div className="space-y-1 mt-2">
                  {inactiveBadges.map((b) => (
                    <div key={b.id} className="text-[11px] text-gray-500 dark:text-gray-400 font-mono px-3 py-1">
                      {b.je_badge} · {fmtDate(b.valid_from, lang)} → {b.valid_until ? fmtDate(b.valid_until, lang) : '—'}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </Section>

          {/* Custom rates */}
          <Section
            title={t('payroll.roster.ratesTitle')}
            action={
              <button onClick={() => setShowRateModal(true)} className="text-xs font-semibold text-[var(--primary)] hover:underline">
                + {t('payroll.roster.addRate')}
              </button>
            }
          >
            {user.custom_rates.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">{t('payroll.roster.noRates')}</p>
            ) : (
              <div className="space-y-1.5">
                {user.custom_rates.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2">
                    <div className="text-xs">
                      <p className="font-semibold text-gray-800 dark:text-gray-100">
                        {rosterCampaignLabel(r.campaign as RosterCampaign, lang)}
                        {r.tier !== null && ` · Tier ${r.tier}`}
                        {r.term_months !== null && ` · ${r.term_months}M`}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {t('payroll.roster.rateCommission')}: ${r.commission_amount.toFixed(2)}
                        {r.override_amount !== null && ` · ${t('payroll.roster.rateOverride')}: $${r.override_amount.toFixed(2)}`}
                      </p>
                      <p className="text-[10px] text-gray-400">{fmtDate(r.valid_from, lang)}{r.valid_until ? ` → ${fmtDate(r.valid_until, lang)}` : ''}</p>
                    </div>
                    <button
                      disabled={deletingRate === r.id}
                      onClick={() => handleDeleteRate(r.id)}
                      className="text-[11px] font-semibold text-red-600 hover:underline disabled:opacity-50"
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Merge */}
          <Section title={t('payroll.roster.mergeTitle')}>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">{t('payroll.roster.mergeHint')}</p>
            <div className="flex items-end gap-2">
              <label className="flex-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t('payroll.roster.mergeDestination')}
                <select
                  value={mergeTarget}
                  onChange={(e) => setMergeTarget(e.target.value)}
                  className="block mt-0.5 w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                >
                  <option value="">{t('payroll.roster.mergePick')}</option>
                  {allUsers
                    .filter((u) => u.id !== user.id && u.role !== 'admin' && u.role !== 'ceo')
                    .map((u) => (
                      <option key={u.id} value={u.id}>{u.name} (@{u.username})</option>
                    ))}
                </select>
              </label>
              <button
                disabled={!mergeTarget}
                onClick={() => onStartMerge(mergeTarget)}
                className="px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 font-semibold text-xs hover:bg-amber-50 disabled:opacity-50"
              >
                {t('payroll.roster.mergeStart')}
              </button>
            </div>
          </Section>
        </div>
      </div>

      {showBadgeModal && (
        <BadgeModal
          userId={user.id}
          defaultCampaign={user.modality === 'retail' ? 'RETAIL' : 'D2D'}
          defaultPosition={user.role as RosterPosition}
          onClose={() => setShowBadgeModal(false)}
          onSaved={() => { setShowBadgeModal(false); onSaved(); }}
        />
      )}
      {showRateModal && (
        <RateModal
          userId={user.id}
          defaultCampaign={user.modality === 'retail' ? 'RETAIL' : 'D2D'}
          onClose={() => setShowRateModal(false)}
          onSaved={() => { setShowRateModal(false); onSaved(); }}
        />
      )}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</h4>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── Badge modal ────────────────────────────────────────────────────────────
function BadgeModal({ userId, defaultCampaign, defaultPosition, onClose, onSaved }: {
  userId: string;
  defaultCampaign: RosterCampaign;
  defaultPosition: RosterPosition;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLanguage();
  const [badge, setBadge] = useState('');
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [campaign, setCampaign] = useState<RosterCampaign>(defaultCampaign);
  const [position, setPosition] = useState<RosterPosition>(defaultPosition);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(''); setSaving(true);
    const res = await fetch('/api/payroll/roster/badges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId, je_badge: badge.trim(), valid_from: validFrom, campaign, position,
      }),
    });
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok) onSaved();
    else setError(j.error || 'Error');
  }

  return (
    <Modal title={t('payroll.roster.addBadgeTitle')} onClose={onClose}>
      <Field label={t('payroll.roster.badgeLabel')}>
        <input type="text" value={badge} onChange={(e) => setBadge(e.target.value)} className={inputClass} />
      </Field>
      <Field label={t('payroll.roster.badgeCampaign')}>
        <select value={campaign} onChange={(e) => setCampaign(e.target.value as RosterCampaign)} className={inputClass}>
          {ROSTER_CAMPAIGNS.map((c) => (<option key={c} value={c}>{c}</option>))}
        </select>
      </Field>
      <Field label={t('payroll.roster.badgePosition')}>
        <select value={position} onChange={(e) => setPosition(e.target.value as RosterPosition)} className={inputClass}>
          {ROSTER_POSITIONS.map((p) => (<option key={p} value={p}>{p}</option>))}
        </select>
      </Field>
      <Field label={t('payroll.roster.validFrom')}>
        <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className={inputClass} />
      </Field>
      {error && <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{error}</p>}
      <ModalActions
        onCancel={onClose}
        onSave={handleSave}
        saving={saving}
        disabled={!badge.trim()}
        saveLabel={t('common.save')}
      />
    </Modal>
  );
}

// ── Custom rate modal ──────────────────────────────────────────────────────
function RateModal({ userId, defaultCampaign, onClose, onSaved }: {
  userId: string;
  defaultCampaign: RosterCampaign;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLanguage();
  const [campaign, setCampaign] = useState<RosterCampaign>(defaultCampaign);
  const [tier, setTier] = useState<string>('');
  const [term, setTerm] = useState<string>('');
  const [commission, setCommission] = useState('');
  const [override, setOverride] = useState('');
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(''); setSaving(true);
    const res = await fetch('/api/payroll/roster/custom-rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        campaign,
        tier: campaign === 'D2D' && tier !== '' ? Number(tier) : null,
        term_months: campaign === 'D2D' && term !== '' ? Number(term) : null,
        commission_amount: Number(commission),
        override_amount: override !== '' ? Number(override) : null,
        valid_from: validFrom,
        valid_until: validUntil || null,
      }),
    });
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok) onSaved();
    else setError(j.error || 'Error');
  }

  return (
    <Modal title={t('payroll.roster.addRateTitle')} onClose={onClose}>
      <Field label={t('payroll.roster.rateCampaign')}>
        <select value={campaign} onChange={(e) => setCampaign(e.target.value as RosterCampaign)} className={inputClass}>
          {ROSTER_CAMPAIGNS.map((c) => (<option key={c} value={c}>{c}</option>))}
        </select>
      </Field>
      {campaign === 'D2D' && (
        <>
          <Field label={t('payroll.roster.rateTier')}>
            <select value={tier} onChange={(e) => setTier(e.target.value)} className={inputClass}>
              <option value="">{t('payroll.roster.anyTier')}</option>
              {[0, 1, 2, 3, 4].map((n) => (<option key={n} value={n}>{n}</option>))}
            </select>
          </Field>
          <Field label={t('payroll.roster.rateTerm')}>
            <select value={term} onChange={(e) => setTerm(e.target.value)} className={inputClass}>
              <option value="">{t('payroll.roster.anyTerm')}</option>
              {D2D_TERM_MONTHS.map((m) => (<option key={m} value={m}>{m}M</option>))}
            </select>
          </Field>
        </>
      )}
      <Field label={t('payroll.roster.rateCommission')}>
        <input type="number" step="0.01" min="0" value={commission} onChange={(e) => setCommission(e.target.value)} className={inputClass} />
      </Field>
      <Field label={t('payroll.roster.rateOverride')}>
        <input type="number" step="0.01" min="0" value={override} onChange={(e) => setOverride(e.target.value)} className={inputClass} placeholder={t('payroll.roster.rateOptional')} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('payroll.roster.validFrom')}>
          <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className={inputClass} />
        </Field>
        <Field label={t('payroll.roster.validUntil')}>
          <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={inputClass} />
        </Field>
      </div>
      {error && <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{error}</p>}
      <ModalActions
        onCancel={onClose}
        onSave={handleSave}
        saving={saving}
        disabled={!commission || Number(commission) <= 0}
        saveLabel={t('common.save')}
      />
    </Modal>
  );
}

// ── Merge flow (preview + confirm + execute) ───────────────────────────────
function MergeFlow({ sourceId, destinationId, onClose, onDone }: {
  sourceId: string;
  destinationId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, lang } = useLanguage();
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'loading' | 'preview' | 'executing' | 'done'>('loading');
  const [confirmText, setConfirmText] = useState('');

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/payroll/roster/merge?dryRun=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: sourceId, destination_id: destinationId }),
      });
      const j = await res.json();
      if (res.ok) { setPreview(j); setStep('preview'); }
      else { setError(j.error || 'Error'); setStep('preview'); }
    })();
  }, [sourceId, destinationId]);

  async function handleConfirm() {
    if (confirmText !== 'FUSIONAR') return;
    setStep('executing'); setError('');
    const res = await fetch('/api/payroll/roster/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_id: sourceId, destination_id: destinationId, confirm: 'FUSIONAR' }),
    });
    const j = await res.json();
    if (res.ok) { setStep('done'); setTimeout(() => onDone(), 1500); }
    else { setError(j.error || 'Error'); setStep('preview'); }
  }

  return (
    <Modal title={t('payroll.roster.mergeTitle')} onClose={onClose}>
      {step === 'loading' && <p className="text-sm text-gray-400">{t('common.loading')}</p>}
      {error && <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{error}</p>}
      {step !== 'loading' && preview && (
        <>
          <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-3 text-xs space-y-1">
            <p><span className="font-semibold">{t('payroll.roster.mergeSource')}:</span> {preview.source.name} (@{preview.source.username})</p>
            <p><span className="font-semibold">{t('payroll.roster.mergeDestination')}:</span> {preview.destination.name} (@{preview.destination.username})</p>
          </div>
          <Bullet count={preview.badges_to_move.length} label={t('payroll.roster.mergeWillMoveBadges')} />
          <Bullet count={preview.future_sales_repointed.length} label={t('payroll.roster.mergeWillRepointSales')} />
          <Bullet count={preview.past_payfiles_preserved.length} label={t('payroll.roster.mergeWillPreservePayfiles')} preserved />
          <Bullet count={preview.negative_balances_preserved.length} label={t('payroll.roster.mergeWillPreserveNegatives')} preserved />
          <p className="text-[11px] text-gray-500 dark:text-gray-400 italic">{t('payroll.roster.mergeIrreversible')}</p>
          {step === 'done' ? (
            <p className="text-sm font-bold text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl px-3 py-2">✓ {t('payroll.roster.mergeDone')}</p>
          ) : (
            <>
              <Field label={t('payroll.roster.mergeConfirmInput')}>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="FUSIONAR"
                  className={inputClass + ' font-mono'}
                />
              </Field>
              <ModalActions
                onCancel={onClose}
                onSave={handleConfirm}
                saving={step === 'executing'}
                disabled={confirmText !== 'FUSIONAR'}
                saveLabel={t('payroll.roster.mergeExecute')}
                saveDanger
              />
            </>
          )}
        </>
      )}
    </Modal>
  );
  void lang;
}

function Bullet({ count, label, preserved = false }: { count: number; label: string; preserved?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`inline-block w-5 text-right font-bold ${preserved ? 'text-gray-400' : 'text-[var(--primary)]'}`}>{count}</span>
      <span className="text-gray-700 dark:text-gray-200">{label}</span>
    </div>
  );
}

// ── Generic modal pieces ───────────────────────────────────────────────────
const inputClass = 'w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]';

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white dark:bg-gray-900 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h4 className="font-bold text-gray-800 dark:text-gray-100">{title}</h4>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-3">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

function ModalActions({ onCancel, onSave, saving, disabled, saveLabel, saveDanger = false }: {
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  disabled: boolean;
  saveLabel: string;
  saveDanger?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex gap-2 pt-2">
      <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-sm">
        {t('common.cancel')}
      </button>
      <button
        onClick={onSave}
        disabled={disabled || saving}
        className={`flex-1 py-2.5 rounded-xl text-white font-bold text-sm disabled:opacity-60 ${saveDanger ? 'bg-red-600 hover:bg-red-700' : ''}`}
        style={saveDanger ? undefined : { backgroundColor: 'var(--primary)' }}
      >
        {saving ? t('common.saving') : saveLabel}
      </button>
    </div>
  );
}

// ── Local helpers ──────────────────────────────────────────────────────────
function campaignLabel(m: Modality, lang: 'es' | 'en'): string {
  if (m === 'd2d') return 'D2D';
  if (m === 'retail') return 'Retail';
  return lang === 'es' ? 'Ambas' : 'Both';
}

function fmtDate(iso: string, lang: 'es' | 'en'): string {
  const d = new Date(iso);
  return d.toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', { year: '2-digit', month: 'short', day: 'numeric' });
}

// Manager_level imported only so the unused-import rule doesn't get angry —
// it's used by labels.ts and re-exported for downstream blocks.
void (null as unknown as ManagerLevel);
