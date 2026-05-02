'use client';
import { useState, useEffect, useMemo, FormEvent, useCallback, useRef } from 'react';
import { useLanguage } from './LanguageContext';
import { fmtTime } from '@/lib/i18n';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

// ── Types ────────────────────────────────────────────────────────────────────
interface Assignee {
  id: string;
  name: string;
  username: string;
  role: string;
  modality: 'd2d' | 'retail' | 'both';
  is_active: boolean;
}
interface Store { id: string; name: string; address: string | null; }
interface AssignmentSummary {
  id: string;
  agent_id: string;
  status: string;
  shift_date: string;
  scheduled_start_time: string;
}

// ── Allowed slots ────────────────────────────────────────────────────────────
// Slot internal values stay HH:MM (server validates against this set), but
// the UI labels render through fmtTime for "10:00 (am)" style.
const SLOTS = ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00'];
// Duration choices — whole hours from 4 to 8.
const DURATIONS = [240, 300, 360, 420, 480];

const todayLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fmtDurationShort = (min: number): string => `${Math.floor(min / 60)}h`;

const ROLE_LABEL_KEY: Record<string, string> = {
  agent: 'admin.roleAgent',
  jr_manager: 'admin.roleJrManager',
  sr_manager: 'admin.roleSrManager',
};

const MODALITY_LABEL_KEY: Record<string, string> = {
  d2d: 'admin.modalityD2D',
  retail: 'admin.modalityRetail',
  both: 'admin.modalityBoth',
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
  preset?: AssignmentFormPreset | null;
  presetVersion?: number;
  onCreated?: (assignmentId: string) => void;
}

// ── Component ────────────────────────────────────────────────────────────────
export default function AssignmentForm({ preset, presetVersion, onCreated }: Props) {
  const { t, lang } = useLanguage();

  // Lookups
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loadingLookups, setLoadingLookups] = useState(true);

  // Form state
  const [agentId, setAgentId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [shiftDate, setShiftDate] = useState(todayLocal());
  const [startTime, setStartTime] = useState('10:00');
  const [durationMin, setDurationMin] = useState(360);

  // Autocomplete state
  const [agentSearch, setAgentSearch] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const [busyByAgentDate, setBusyByAgentDate] = useState<Map<string, AssignmentSummary>>(new Map());

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // ── Load assignees + stores ─────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [aRes, sRes] = await Promise.all([
          fetch('/api/users', { cache: 'no-store' }),
          fetch('/api/shift/stores', { cache: 'no-store' }),
        ]);
        if (aRes.ok) {
          const list: Assignee[] = await aRes.json();
          setAssignees(
            list
              .filter((u) => ['agent', 'jr_manager', 'sr_manager'].includes(u.role) && u.is_active !== false)
              .sort((a, b) => a.name.localeCompare(b.name)),
          );
        }
        if (sRes.ok) setStores(await sRes.json());
      } catch (err) {
        console.error('[AssignmentForm] lookups error', err);
      }
      setLoadingLookups(false);
    })();
  }, []);

  // Apply preset whenever the parent bumps presetVersion
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

  // Refresh "busy" map when date changes
  const refreshBusy = useCallback(async (date: string) => {
    if (!date) { setBusyByAgentDate(new Map()); return; }
    try {
      const res = await fetch(
        `/api/assignments?date=${encodeURIComponent(date)}&statuses=pending,accepted,in_progress,completed,incomplete&limit=500`,
        { cache: 'no-store' },
      );
      if (!res.ok) return;
      const data = await res.json();
      const map = new Map<string, AssignmentSummary>();
      for (const a of (data.assignments ?? []) as AssignmentSummary[]) map.set(a.agent_id, a);
      setBusyByAgentDate(map);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { refreshBusy(shiftDate); }, [shiftDate, refreshBusy]);

  useEffect(() => {
    const sb = getSupabaseBrowser();
    const channel = sb.channel('assignment-form-busy')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments' }, () => { refreshBusy(shiftDate); })
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [shiftDate, refreshBusy]);

  // Combobox suggestions: empty query → full active list (sorted A-Z so a
  // click reveals every option; the user can scroll). Typed query → partial
  // match against name OR username, accent-insensitive (NFD strip).
  // No 8-row cap — the dropdown has internal max-height + scroll.
  const suggestions = useMemo(() => {
    if (agentId) return [];
    const norm = (s: string) =>
      s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const q = norm(agentSearch.trim());
    if (!q) return assignees;
    return assignees.filter((a) => norm(a.name).includes(q) || norm(a.username).includes(q));
  }, [assignees, agentSearch, agentId]);

  const selectedAgent = useMemo(() => assignees.find((a) => a.id === agentId), [assignees, agentId]);
  const selectedAgentBusy = agentId ? busyByAgentDate.get(agentId) : null;

  // Close suggestions on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    if (showSuggestions) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showSuggestions]);

  const pickAssignee = (a: Assignee) => {
    setAgentId(a.id);
    setAgentSearch('');
    setShowSuggestions(false);
  };
  const clearAssignee = () => {
    setAgentId('');
    setAgentSearch('');
    setShowSuggestions(false);
  };

  // ── Submit ───────────────────────────────────────────────────────────────
  const resetForm = () => {
    setAgentId('');
    setAgentSearch('');
    setStoreId('');
    setShiftDate(todayLocal());
    setStartTime('10:00');
    setDurationMin(360);
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
      const name = selectedAgent?.name ?? '';
      setSuccess(t('assignments.successCreated').replace('{agent}', name));
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
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 sm:p-6 overflow-hidden">
      <h2 className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
        <span>📋</span> {t('assignments.formTitle')}
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* ── Assignee autocomplete ──────────────────────────────────────── */}
        <div ref={suggestionsRef} className="relative">
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
            {t('assignments.fieldAgent')}
          </label>
          {selectedAgent ? (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-[var(--primary)] bg-[var(--primary-light)] text-sm">
              <div className="min-w-0 flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">{selectedAgent.name}</span>
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                  {t(ROLE_LABEL_KEY[selectedAgent.role] ?? 'admin.roleAgent')}
                </span>
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                  {t(MODALITY_LABEL_KEY[selectedAgent.modality] ?? 'admin.modalityD2D')}
                </span>
              </div>
              <button type="button" onClick={clearAssignee}
                className="text-[11px] font-semibold underline text-[var(--primary)] flex-shrink-0">
                {t('common.edit')}
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={agentSearch}
                role="combobox"
                aria-expanded={showSuggestions}
                aria-controls="agent-suggestions-list"
                aria-autocomplete="list"
                onChange={(e) => {
                  setAgentSearch(e.target.value);
                  setShowSuggestions(true);
                  setHighlightIdx(0);
                }}
                onFocus={() => { setShowSuggestions(true); setHighlightIdx(0); }}
                onClick={() => setShowSuggestions(true)}
                onKeyDown={(e) => {
                  if (!showSuggestions) {
                    if (e.key === 'ArrowDown' || e.key === 'Enter') {
                      e.preventDefault();
                      setShowSuggestions(true);
                      setHighlightIdx(0);
                    }
                    return;
                  }
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setHighlightIdx((i) => Math.min(suggestions.length - 1, i + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setHighlightIdx((i) => Math.max(0, i - 1));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const pick = suggestions[highlightIdx];
                    if (pick && !busyByAgentDate.has(pick.id)) pickAssignee(pick);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowSuggestions(false);
                  }
                }}
                placeholder={t('assignments.agentSearchPlaceholder')}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm placeholder-gray-400"
                autoComplete="off"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div
                  id="agent-suggestions-list"
                  role="listbox"
                  className="absolute left-0 right-0 mt-1 z-30 max-h-72 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg"
                >
                  {suggestions.map((a, idx) => {
                    const busy = busyByAgentDate.has(a.id);
                    const highlighted = idx === highlightIdx;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        role="option"
                        aria-selected={highlighted}
                        disabled={busy}
                        onClick={() => pickAssignee(a)}
                        onMouseEnter={() => setHighlightIdx(idx)}
                        className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 transition-colors ${
                          busy ? 'opacity-50 cursor-not-allowed' : highlighted ? 'bg-gray-100 dark:bg-gray-800' : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <div className="min-w-0 flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-gray-900 dark:text-gray-100 truncate">{a.name}</span>
                          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                            {t(ROLE_LABEL_KEY[a.role] ?? 'admin.roleAgent')}
                          </span>
                          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                            {t(MODALITY_LABEL_KEY[a.modality] ?? 'admin.modalityD2D')}
                          </span>
                        </div>
                        {busy && <span className="text-[10px] text-amber-600 dark:text-amber-400 flex-shrink-0">{t('assignments.alreadyAssigned')}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
              {showSuggestions && suggestions.length === 0 && (
                <div className="absolute left-0 right-0 mt-1 z-30 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg px-3 py-2 text-xs text-gray-400">
                  {t('assignments.searchEmpty')}
                </div>
              )}
            </>
          )}
          {selectedAgentBusy && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1.5">
              ⚠️ {t('assignments.alreadyAssignedHint')}
              <span className="font-mono ml-1">
                · {selectedAgentBusy.shift_date} · {fmtTime(selectedAgentBusy.scheduled_start_time, lang)}
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
            className="w-full max-w-full box-border px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm"
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

        {/* ── Date ──────────────────────────────────────────────────────── */}
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
            className="w-full max-w-full box-border px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm appearance-none"
            style={{ minWidth: 0 }}
          />
        </div>

        {/* ── Start time button group ───────────────────────────────────── */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
            {t('assignments.fieldStartTime')}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {SLOTS.map((slot) => {
              const active = startTime === slot;
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => setStartTime(slot)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
                    active
                      ? 'border-[var(--primary)] text-white bg-[var(--primary)]'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300'
                  }`}
                >
                  {fmtTime(slot, lang)}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Duration button group ─────────────────────────────────────── */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
            {t('assignments.fieldDuration')}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {DURATIONS.map((d) => {
              const active = durationMin === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDurationMin(d)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
                    active
                      ? 'border-[var(--primary)] text-white bg-[var(--primary)]'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300'
                  }`}
                >
                  {fmtDurationShort(d)}
                  {d === 360 ? <span className="ml-1 opacity-70 font-normal">· {t('assignments.standardLabel')}</span> : null}
                </button>
              );
            })}
          </div>
        </div>

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

        <button
          type="submit"
          disabled={submitting || !!selectedAgentBusy || !agentId}
          className="w-full py-2.5 rounded-xl text-white font-bold text-sm transition-colors disabled:opacity-60"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          {submitting ? t('assignments.submitting') : t('assignments.submitBtn')}
        </button>
      </form>
    </div>
  );
}
