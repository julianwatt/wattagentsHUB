'use client';
import { useState, useEffect, useMemo, FormEvent, useCallback } from 'react';
import { useLanguage } from './LanguageContext';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

// ── Types ────────────────────────────────────────────────────────────────────
interface Agent { id: string; name: string; username: string; role: string; is_active: boolean; }
interface Store { id: string; name: string; address: string | null; }
interface AssignmentSummary {
  id: string;
  agent_id: string;
  status: string;
  shift_date: string;
  scheduled_start_time: string;
}

// ── Allowed slots ────────────────────────────────────────────────────────────
const SLOTS = ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00'];
// Duration choices (minutes, 4h–8h in 30-min steps)
const DURATIONS = [240, 270, 300, 330, 360, 390, 420, 450, 480];

const todayLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fmtDuration = (min: number): string => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

// ── Public props (so the parent can preload values for "reasignar") ─────────
export interface AssignmentFormPreset {
  agent_id?: string;
  store_id?: string;
  shift_date?: string;
  scheduled_start_time?: string;
  expected_duration_min?: number;
}

interface Props {
  /** Optional preset for "reasignar tras rechazo" flow. */
  preset?: AssignmentFormPreset | null;
  /** Bumped by the parent to force the form to re-apply a preset. */
  presetVersion?: number;
  /** Called after a successful create (used by parent to refresh listing). */
  onCreated?: (assignmentId: string) => void;
}

// ── Component ────────────────────────────────────────────────────────────────
export default function AssignmentForm({ preset, presetVersion, onCreated }: Props) {
  const { t, lang } = useLanguage();

  // Lookups
  const [agents, setAgents] = useState<Agent[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loadingLookups, setLoadingLookups] = useState(true);

  // Form state
  const [agentId, setAgentId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [shiftDate, setShiftDate] = useState(todayLocal());
  const [startTime, setStartTime] = useState('10:00');
  const [durationMin, setDurationMin] = useState(360);

  // Agent search filter
  const [agentSearch, setAgentSearch] = useState('');

  // Existing assignments (for "agent already has one for that date" hint)
  const [busyByAgentDate, setBusyByAgentDate] = useState<Map<string, AssignmentSummary>>(new Map());

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // ── Load agents + stores on mount ────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [aRes, sRes] = await Promise.all([
          fetch('/api/users', { cache: 'no-store' }),
          fetch('/api/shift/stores', { cache: 'no-store' }),
        ]);
        if (aRes.ok) {
          const list: Agent[] = await aRes.json();
          setAgents(
            list
              .filter((u) => u.role === 'agent' && u.is_active !== false)
              .sort((a, b) => a.name.localeCompare(b.name)),
          );
        }
        if (sRes.ok) {
          setStores(await sRes.json());
        }
      } catch (err) {
        console.error('[AssignmentForm] lookups error', err);
      }
      setLoadingLookups(false);
    })();
  }, []);

  // ── Apply preset whenever the parent bumps presetVersion ─────────────────
  useEffect(() => {
    if (!preset) return;
    if (preset.agent_id) setAgentId(preset.agent_id);
    if (preset.store_id) setStoreId(preset.store_id);
    if (preset.shift_date) setShiftDate(preset.shift_date);
    if (preset.scheduled_start_time) setStartTime(preset.scheduled_start_time);
    if (preset.expected_duration_min) setDurationMin(preset.expected_duration_min);
    setFormError(null);
    setSuccess(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetVersion]);

  // ── When the date changes, fetch which agents already have an assignment ─
  const refreshBusy = useCallback(async (date: string) => {
    if (!date) {
      setBusyByAgentDate(new Map());
      return;
    }
    try {
      const res = await fetch(
        `/api/assignments?date=${encodeURIComponent(date)}&statuses=pending,accepted,in_progress,completed,incomplete&limit=500`,
        { cache: 'no-store' },
      );
      if (!res.ok) return;
      const data = await res.json();
      const map = new Map<string, AssignmentSummary>();
      for (const a of (data.assignments ?? []) as AssignmentSummary[]) {
        map.set(a.agent_id, a);
      }
      setBusyByAgentDate(map);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    refreshBusy(shiftDate);
  }, [shiftDate, refreshBusy]);

  // Realtime: refresh "busy" map when assignments change
  useEffect(() => {
    const sb = getSupabaseBrowser();
    const channel = sb
      .channel('assignment-form-busy')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'assignments' },
        () => { refreshBusy(shiftDate); },
      )
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [shiftDate, refreshBusy]);

  // ── Filtered agent list (search + show busy badge) ───────────────────────
  const filteredAgents = useMemo(() => {
    const q = agentSearch.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) => a.name.toLowerCase().includes(q) || a.username.toLowerCase().includes(q),
    );
  }, [agents, agentSearch]);

  const selectedAgentBusy = agentId ? busyByAgentDate.get(agentId) : null;

  // ── Submit ───────────────────────────────────────────────────────────────
  const resetForm = () => {
    setAgentId('');
    setStoreId('');
    setShiftDate(todayLocal());
    setStartTime('10:00');
    setDurationMin(360);
    setAgentSearch('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccess(null);

    if (!agentId || !storeId || !shiftDate || !startTime) {
      setFormError(t('assignments.errorRequired'));
      return;
    }
    if (selectedAgentBusy) {
      setFormError(t('assignments.errorAlreadyAssigned'));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId,
          store_id: storeId,
          shift_date: shiftDate,
          scheduled_start_time: startTime,
          expected_duration_min: durationMin,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 409 && data?.error === 'duplicate') {
          setFormError(data.message ?? t('assignments.errorAlreadyAssigned'));
        } else {
          setFormError(data?.error ?? t('assignments.errorGeneric'));
        }
        setSubmitting(false);
        return;
      }

      // Success — show message, clear form
      const agentName = agents.find((a) => a.id === agentId)?.name ?? '';
      setSuccess(t('assignments.successCreated').replace('{agent}', agentName));
      resetForm();
      onCreated?.(data.assignment?.id);
    } catch {
      setFormError(t('assignments.errorGeneric'));
    }
    setSubmitting(false);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  if (loadingLookups) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {t('common.loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 sm:p-6">
      <h2 className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
        <span>📋</span> {t('assignments.formTitle')}
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* ── Agent ──────────────────────────────────────────────────────── */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
            {t('assignments.fieldAgent')}
          </label>
          <input
            type="text"
            value={agentSearch}
            onChange={(e) => setAgentSearch(e.target.value)}
            placeholder={t('assignments.agentSearchPlaceholder')}
            className="w-full px-3 py-2 mb-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm placeholder-gray-400"
          />
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            required
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm"
          >
            <option value="">{t('assignments.agentChoose')}</option>
            {filteredAgents.map((a) => {
              const busy = busyByAgentDate.has(a.id);
              return (
                <option key={a.id} value={a.id} disabled={busy && a.id !== agentId}>
                  {a.name}
                  {busy ? ` — ${t('assignments.alreadyAssigned')}` : ''}
                </option>
              );
            })}
          </select>
          {selectedAgentBusy && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1.5">
              ⚠️ {t('assignments.alreadyAssignedHint')}
              <span className="font-mono ml-1">
                · {selectedAgentBusy.shift_date} · {selectedAgentBusy.scheduled_start_time}
              </span>
            </p>
          )}
        </div>

        {/* ── Store ─────────────────────────────────────────────────────── */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
            {t('assignments.fieldStore')}
          </label>
          <select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            required
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm"
          >
            <option value="">{t('assignments.storeChoose')}</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.address ? ` — ${s.address}` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* ── Date + start time + duration row ──────────────────────────── */}
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
              {t('assignments.fieldDate')}
            </label>
            <input
              type="date"
              value={shiftDate}
              min={todayLocal()}
              onChange={(e) => setShiftDate(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
              {t('assignments.fieldStartTime')}
            </label>
            <select
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm"
            >
              {SLOTS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
              {t('assignments.fieldDuration')}
            </label>
            <select
              value={durationMin}
              onChange={(e) => setDurationMin(parseInt(e.target.value, 10))}
              required
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm"
            >
              {DURATIONS.map((d) => (
                <option key={d} value={d}>{fmtDuration(d)}{d === 360 ? ` (${lang === 'es' ? 'estándar' : 'standard'})` : ''}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Error / success banners ───────────────────────────────────── */}
        {formError && (
          <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2.5">
            {formError}
          </p>
        )}
        {success && (
          <p className="text-xs text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20 rounded-xl px-3 py-2.5">
            ✓ {success}
          </p>
        )}

        {/* ── Submit ────────────────────────────────────────────────────── */}
        <button
          type="submit"
          disabled={submitting || !!selectedAgentBusy}
          className="w-full py-2.5 rounded-xl text-white font-bold text-sm transition-colors disabled:opacity-60"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          {submitting ? t('assignments.submitting') : t('assignments.submitBtn')}
        </button>
      </form>
    </div>
  );
}
