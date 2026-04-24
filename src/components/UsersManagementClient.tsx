'use client';
import { useState, useEffect, useCallback, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Session } from 'next-auth';
import AppLayout from './AppLayout';
import { useLanguage } from './LanguageContext';
import ToggleSwitch from './ToggleSwitch';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

type UserRole = 'agent' | 'jr_manager' | 'sr_manager' | 'admin' | 'ceo';
type Tab = 'users' | 'roster';
type ActiveFilter = 'all' | 'active' | 'inactive';

interface User {
  id: string;
  username: string;
  name: string;
  email: string | null;
  role: UserRole;
  manager_id: string | null;
  must_change_password: boolean;
  is_active: boolean;
  hire_date: string;
  created_at: string;
}

interface CreatedUserInfo { username: string; name: string; tempPassword: string; emailSent: boolean; email: string | null; }

const ITEMS_PER_PAGE = 15;
const today = () => new Date().toLocaleDateString('en-CA');

function roleBadgeClass(role: UserRole): string {
  switch (role) {
    case 'ceo':        return 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300';
    case 'admin':      return 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300';
    case 'sr_manager': return 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300';
    case 'jr_manager': return 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300';
    default:           return 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300';
  }
}

const ROLE_ORDER: Record<UserRole, number> = { admin: 0, ceo: 1, sr_manager: 2, jr_manager: 3, agent: 4 };

function sortUsers(list: User[]): User[] {
  return [...list].sort((a, b) => {
    const ra = ROLE_ORDER[a.role] ?? 9;
    const rb = ROLE_ORDER[b.role] ?? 9;
    if (ra !== rb) return ra - rb;
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return b.hire_date.localeCompare(a.hire_date);
  });
}

// ─── Section divider for the create form ────────────────────────────────────
function FormSection({ num, label }: { num: number; label: string }) {
  return (
    <div className="flex items-center gap-2 -mx-3 sm:-mx-5 px-3 sm:px-5 py-2 bg-gray-50 dark:bg-gray-800/50 border-y border-gray-100 dark:border-gray-700/50 mb-3 mt-4 first:mt-0">
      <span
        className="w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}
      >
        {num}
      </span>
      <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</span>
    </div>
  );
}

// ─── Roster tab internal components ─────────────────────────────────────────
interface TeamCard {
  jrManager: User | null;
  srManager: User | null;
  agents: User[];
}
interface SrSection {
  srManager: User;
  teams: TeamCard[];
}

function TeamCardComponent({ team, toggling, onToggle, t }: {
  team: TeamCard;
  toggling: string | null;
  onToggle: (id: string, active: boolean) => void;
  t: (k: string) => string;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-50 dark:border-gray-800" style={{ backgroundColor: 'var(--primary-light)' }}>
        <p className="text-xs font-bold text-gray-800 dark:text-gray-100">
          {team.jrManager
            ? `${t('roster.teamOf')} ${team.jrManager.name}`
            : t('roster.directAgents')}
        </p>
        {team.srManager && team.jrManager && (
          <p className="text-[10px] text-gray-500 dark:text-gray-400">{t('roster.srManager')}: {team.srManager.name}</p>
        )}
      </div>
      <div className="divide-y divide-gray-50 dark:divide-gray-800">
        {team.agents.length === 0 ? (
          <p className="text-xs text-gray-400 px-4 py-3 text-center">—</p>
        ) : team.agents.map((a) => (
          <AgentRow key={a.id} agent={a} toggling={toggling} onToggle={onToggle} t={t} />
        ))}
      </div>
    </div>
  );
}

function AgentRow({ agent, toggling, onToggle, t }: {
  agent: User;
  toggling: string | null;
  onToggle: (id: string, active: boolean) => void;
  t: (k: string) => string;
}) {
  const isToggling = toggling === agent.id;
  return (
    <div className="px-4 py-2.5 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0"
          style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
          {agent.name.charAt(0).toUpperCase()}
        </div>
        <p className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{agent.name}</p>
      </div>
      <ToggleSwitch checked={agent.is_active} onChange={(v) => onToggle(agent.id, v)} disabled={isToggling} />
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function UsersManagementClient({ session }: { session: Session }) {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const viewerRole = session.user.role as UserRole;
  const isCeoViewer = viewerRole === 'ceo';
  const [activeTab, setActiveTab] = useState<Tab>('users');

  // ── Shared user data ──
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const ceoExists = users.some((u) => u.role === 'ceo');

  const fetchUsers = useCallback(async () => {
    const res = await fetch('/api/users');
    if (res.ok) setUsers(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // ── Realtime (for both tabs) ──
  useEffect(() => {
    const sb = getSupabaseBrowser();
    const channel = sb.channel('manage-users').on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'users' },
      () => { fetchUsers(); },
    ).subscribe();
    return () => { sb.removeChannel(channel); };
  }, [fetchUsers]);

  // ── Toggle active ──
  const handleToggleActive = async (userId: string, newActive: boolean) => {
    setToggling(userId);
    const res = await fetch('/api/roster', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: userId, is_active: newActive }),
    });
    if (res.ok) {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, is_active: newActive } : u));
    }
    setToggling(null);
  };

  // ── Delete ──
  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`${t('admin.deleteConfirm')} "${name}"?`)) return;
    const res = await fetch('/api/users', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    if (res.ok) fetchUsers();
  };

  // ── Create form state ──
  const [form, setForm] = useState({
    username: '', name: '', email: '',
    role: 'agent' as UserRole,
    manager_id: '', sr_manager_filter: '',
    hire_date: today(),
  });
  const [formError, setFormError] = useState('');
  const [created, setCreated] = useState<CreatedUserInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(''); setCreated(null); setSubmitting(true);
    const { sr_manager_filter: srFilter, ...formData } = form;
    const resolvedMgr = formData.role === 'agent'
      ? (formData.manager_id || srFilter || null)
      : (formData.manager_id || null);
    const payload = { ...formData, manager_id: resolvedMgr, email: formData.email || null };
    const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    setSubmitting(false);
    if (res.ok) {
      const data = await res.json();
      setCreated({ username: data.username, name: data.name, tempPassword: data.tempPassword, emailSent: data.emailSent, email: data.email });
      setForm({ username: '', name: '', email: '', role: 'agent', manager_id: '', sr_manager_filter: '', hire_date: today() });
      fetchUsers();
    } else {
      const d = await res.json();
      setFormError(d.error || 'Error');
    }
  };

  // ── Edit modal state ──
  const [editing, setEditing] = useState<User | null>(null);

  // ── Table search / filter / pagination ──
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [page, setPage] = useState(1);

  const filteredUsers = sortUsers(users).filter((u) => {
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      u.name.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      (u.email ?? '').toLowerCase().includes(q);
    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    const matchesActive =
      activeFilter === 'all' ||
      (activeFilter === 'active' ? u.is_active : !u.is_active);
    return matchesSearch && matchesRole && matchesActive;
  });

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / ITEMS_PER_PAGE));
  const paginatedUsers = filteredUsers.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [search, roleFilter, activeFilter]);

  // ── Roster tab grouping ──
  const rosterAgents = users.filter((u) => u.role === 'agent');
  const srManagers = users.filter((u) => u.role === 'sr_manager');
  const jrManagers = users.filter((u) => u.role === 'jr_manager');

  const sections: SrSection[] = srManagers.map((sr) => {
    const srsJrs = jrManagers.filter((jr) => jr.manager_id === sr.id);
    const teams: TeamCard[] = srsJrs.map((jr) => ({
      jrManager: jr,
      srManager: sr,
      agents: rosterAgents.filter((a) => a.manager_id === jr.id),
    }));
    const directAgents = rosterAgents.filter((a) => a.manager_id === sr.id);
    if (directAgents.length > 0) {
      teams.push({ jrManager: null, srManager: sr, agents: directAgents });
    }
    return { srManager: sr, teams };
  });

  const orphanJrs = jrManagers.filter((jr) => !jr.manager_id || !srManagers.some((sr) => sr.id === jr.manager_id));
  const orphanTeams: TeamCard[] = orphanJrs.map((jr) => ({
    jrManager: jr,
    srManager: null,
    agents: rosterAgents.filter((a) => a.manager_id === jr.id),
  }));
  const unassignedAgents = rosterAgents.filter(
    (a) => !a.manager_id ||
      (!jrManagers.some((jr) => jr.id === a.manager_id) && !srManagers.some((sr) => sr.id === a.manager_id)),
  );

  // ── Role label helper ──
  const roleLabel = (r: UserRole | 'all'): string => {
    if (r === 'all') return lang === 'es' ? 'Todos' : 'All';
    return r === 'ceo' ? t('admin.roleCeo')
      : r === 'admin' ? t('admin.roleAdmin')
      : r === 'sr_manager' ? t('admin.roleSrManager')
      : r === 'jr_manager' ? t('admin.roleJrManager')
      : t('admin.roleAgent');
  };

  return (
    <AppLayout session={session}>
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-4 overflow-x-hidden">
        {/* Page header */}
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{t('admin.title')}</h1>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700">
          {(['users', 'roster'] as Tab[]).filter((tab) => tab === 'users' || !isCeoViewer).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap ${
                activeTab === tab
                  ? 'border-[var(--primary)] text-[var(--primary)]'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {tab === 'users' ? t('admin.tabUsers') : t('admin.tabRoster')}
            </button>
          ))}
          <button
            onClick={() => router.push('/manage/shifts')}
            className="px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            {t('admin.tabShifts')}
          </button>
        </div>

        {/* ── USERS TAB ── */}
        {activeTab === 'users' && (
          <div className="grid md:grid-cols-3 gap-5 min-w-0">
            {/* Create user form — 3 sections */}
            <div className="md:col-span-1">
              <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-3 sm:p-5">
                <h3 className="font-bold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2 text-sm">
                  <svg className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--primary)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  {t('admin.addUser')}
                </h3>

                <form onSubmit={handleAdd} className="space-y-3">
                  {/* Section 1 — Identity */}
                  <FormSection num={1} label={t('admin.formSectionIdentity')} />
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('admin.fullName')}</label>
                    <input type="text" value={form.name} required onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder={lang === 'es' ? 'Ej. María López' : 'e.g. Jane Doe'}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm placeholder-gray-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('admin.username')}</label>
                    <input type="text" value={form.username} required onChange={(e) => setForm({ ...form, username: e.target.value })}
                      placeholder="mlopez"
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm placeholder-gray-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('admin.emailLabel')}</label>
                    <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="maria@watt.com"
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm placeholder-gray-400" />
                    <p className="text-[10px] text-gray-400 mt-1">{t('admin.tempPasswordHint')}</p>
                  </div>

                  {/* Section 2 — Role & hierarchy */}
                  <FormSection num={2} label={t('admin.formSectionRole')} />
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('admin.role')}</label>
                    <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole, manager_id: '', sr_manager_filter: '' })}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm">
                      <option value="agent">{t('admin.roleAgent')}</option>
                      <option value="jr_manager">{t('admin.roleJrManager')}</option>
                      <option value="sr_manager">{t('admin.roleSrManager')}</option>
                      <option value="ceo" disabled={ceoExists}>{t('admin.roleCeo')}{ceoExists ? ` (${t('common.alreadyExists')})` : ''}</option>
                    </select>
                  </div>
                  {form.role === 'agent' && (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('admin.srManagerFilter')}</label>
                        <select value={form.sr_manager_filter} onChange={(e) => setForm({ ...form, sr_manager_filter: e.target.value, manager_id: '' })}
                          className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm">
                          <option value="">{t('admin.noSrManager')}</option>
                          {users.filter((u) => u.role === 'sr_manager').map((u) => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('admin.roleJrManager')}</label>
                        <select value={form.manager_id} onChange={(e) => setForm({ ...form, manager_id: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm">
                          <option value="">{t('admin.noJrManager')}</option>
                          {users.filter((u) => u.role === 'jr_manager' && (!form.sr_manager_filter || u.manager_id === form.sr_manager_filter)).map((u) => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                  {form.role === 'jr_manager' && (
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('admin.roleSrManager')}</label>
                      <select value={form.manager_id} onChange={(e) => setForm({ ...form, manager_id: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm">
                        <option value="">{t('admin.noSrManager')}</option>
                        {users.filter((u) => u.role === 'sr_manager').map((u) => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Section 3 — Employment */}
                  <FormSection num={3} label={t('admin.formSectionMeta')} />
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('admin.hireDate')}</label>
                    <input type="date" value={form.hire_date} required onChange={(e) => setForm({ ...form, hire_date: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm" />
                  </div>

                  {formError && <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{formError}</p>}

                  {created && (
                    <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-3 space-y-1.5">
                      <p className="text-sm font-bold text-green-700 dark:text-green-300">✓ {t('admin.registerSuccess')}: {created.name}</p>
                      <div className="text-xs">
                        <p className="text-gray-600 dark:text-gray-300">{t('admin.tempPasswordLabel')}</p>
                        <code className="block mt-1 bg-white dark:bg-gray-800 px-2 py-1.5 rounded text-sm font-mono font-bold text-gray-800 dark:text-gray-100 select-all">{created.tempPassword}</code>
                      </div>
                      {created.email && (
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">
                          {created.emailSent
                            ? `📧 ${t('admin.tempPasswordSentTo')} ${created.email}`
                            : `⚠ ${t('admin.tempPasswordNotSent')} ${created.email}`}
                        </p>
                      )}
                      <button type="button" onClick={() => setCreated(null)} className="text-[11px] text-gray-400 hover:text-gray-600 underline mt-1">{t('common.close')}</button>
                    </div>
                  )}

                  <button type="submit" disabled={submitting}
                    className="w-full py-2.5 rounded-xl text-white font-bold text-sm transition-colors disabled:opacity-60"
                    style={{ backgroundColor: 'var(--primary)' }}>
                    {submitting ? t('admin.creating') : t('admin.createBtn')}
                  </button>
                </form>
              </div>
            </div>

            {/* Users table */}
            <div className="md:col-span-2 space-y-0">
              <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
                {/* Table header */}
                <div className="px-3 sm:px-5 py-3 sm:py-4 border-b border-gray-50 dark:border-gray-800">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">{t('admin.usersTable')}</h3>
                    <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full px-2.5 py-0.5 font-semibold flex-shrink-0">
                      {filteredUsers.length}
                      {filteredUsers.length !== users.length && <span className="text-gray-400"> / {users.length}</span>}
                    </span>
                  </div>

                  {/* Search input */}
                  <div className="relative mb-2">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t('admin.searchPlaceholder')}
                      className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-xs placeholder-gray-400"
                    />
                    {search && (
                      <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
                    )}
                  </div>

                  {/* Role chips */}
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {(['all', 'agent', 'jr_manager', 'sr_manager', 'ceo', 'admin'] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => setRoleFilter(r)}
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
                          roleFilter === r
                            ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary-light)]'
                            : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
                        }`}
                      >
                        {roleLabel(r)}
                      </button>
                    ))}
                    <div className="w-px bg-gray-200 dark:bg-gray-700 self-stretch mx-0.5" />
                    {(['all', 'active', 'inactive'] as ActiveFilter[]).map((f) => (
                      <button
                        key={f}
                        onClick={() => setActiveFilter(f)}
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
                          activeFilter === f
                            ? f === 'active'
                              ? 'border-emerald-400 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20'
                              : f === 'inactive'
                              ? 'border-red-400 text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20'
                              : 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary-light)]'
                            : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
                        }`}
                      >
                        {f === 'all' ? (lang === 'es' ? 'Todos' : 'All')
                          : f === 'active' ? t('admin.filterActive')
                          : t('admin.filterInactive')}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Table rows */}
                {loading ? (
                  <div className="p-12 text-center text-gray-400 text-sm">{t('common.loading')}</div>
                ) : filteredUsers.length === 0 ? (
                  <div className="p-12 text-center text-gray-400 text-sm">{t('common.noData')}</div>
                ) : (
                  <div className="divide-y divide-gray-50 dark:divide-gray-800">
                    {paginatedUsers.map((u) => (
                      <div key={u.id} className={`flex items-center justify-between px-3 sm:px-5 py-3 sm:py-4 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 ${!u.is_active ? 'opacity-50' : ''}`}>
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                          <div
                            className={`w-7 h-7 sm:w-9 sm:h-9 rounded-full flex items-center justify-center font-bold text-xs sm:text-sm flex-shrink-0 ${
                              u.role === 'admin' || u.role === 'ceo'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                                : ''
                            }`}
                            style={u.role !== 'admin' && u.role !== 'ceo'
                              ? { backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }
                              : undefined}
                          >
                            {u.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-800 dark:text-gray-100 text-xs sm:text-sm truncate">{u.name}</p>
                            <p className="text-[10px] sm:text-xs text-gray-400 truncate">@{u.username}<span className="hidden sm:inline">{u.email ? ` · ${u.email}` : ''}</span></p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                          <span className={`text-[10px] sm:text-xs font-bold px-1.5 sm:px-2 py-0.5 rounded-full whitespace-nowrap ${roleBadgeClass(u.role)}`}>
                            {u.role === 'ceo' ? t('admin.roleCeo')
                              : u.role === 'admin' ? t('admin.roleAdmin')
                              : u.role === 'sr_manager' ? t('admin.roleSrManager')
                              : u.role === 'jr_manager' ? t('admin.roleJrManager')
                              : t('admin.roleAgent')}
                          </span>
                          <button onClick={() => setEditing(u)}
                            title={t('common.edit')}
                            className="p-1 sm:p-1.5 rounded-lg text-gray-400 hover:text-[var(--primary)] hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                            <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                          {u.id !== session.user.id && !(isCeoViewer && u.role === 'admin') && (
                            <button onClick={() => handleDelete(u.id, u.name)}
                              title={t('common.delete')}
                              className="p-1 sm:p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                              <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          )}
                          {u.role !== 'admin' && u.id !== session.user.id && (
                            <ToggleSwitch
                              checked={u.is_active}
                              onChange={(v) => handleToggleActive(u.id, v)}
                              disabled={toggling === u.id}
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-3 sm:px-5 py-3 border-t border-gray-50 dark:border-gray-800">
                    <span className="text-[11px] text-gray-400">
                      {lang === 'es'
                        ? `${filteredUsers.length} usuarios · pág. ${page} de ${totalPages}`
                        : `${filteredUsers.length} users · page ${page} of ${totalPages}`}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        disabled={page === 1}
                        onClick={() => setPage((p) => p - 1)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                      </button>
                      {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                        .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                          if (idx > 0 && typeof arr[idx - 1] === 'number' && (p as number) - (arr[idx - 1] as number) > 1) {
                            acc.push('...');
                          }
                          acc.push(p);
                          return acc;
                        }, [])
                        .map((p, idx) =>
                          p === '...' ? (
                            <span key={`ellipsis-${idx}`} className="text-[11px] text-gray-400 px-1">…</span>
                          ) : (
                            <button
                              key={p}
                              onClick={() => setPage(p as number)}
                              className={`w-7 h-7 rounded-lg text-[11px] font-semibold transition-colors ${
                                page === p
                                  ? 'text-white'
                                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                              }`}
                              style={page === p ? { backgroundColor: 'var(--primary)' } : {}}
                            >
                              {p}
                            </button>
                          ),
                        )}
                      <button
                        disabled={page === totalPages}
                        onClick={() => setPage((p) => p + 1)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── ROSTER TAB ── */}
        {activeTab === 'roster' && (
          <div className="space-y-6">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('roster.subtitle')}</p>
            </div>

            {loading ? (
              <div className="text-center py-20 text-gray-400">{t('common.loading')}</div>
            ) : rosterAgents.length === 0 && unassignedAgents.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-4xl mb-3">📋</p>
                <p className="text-gray-600 dark:text-gray-300 font-medium">{t('roster.noAgents')}</p>
              </div>
            ) : (
              <div className="space-y-8">
                {sections.map((section) => (
                  <div key={section.srManager.id}>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                      <span className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        {t('roster.srManager')}: {section.srManager.name}
                      </span>
                      <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                    </div>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {section.teams.map((team, i) => (
                        <TeamCardComponent key={team.jrManager?.id ?? `direct-${i}`} team={team} toggling={toggling} onToggle={handleToggleActive} t={t} />
                      ))}
                    </div>
                  </div>
                ))}

                {orphanTeams.length > 0 && (
                  <div>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                      <span className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        {t('roster.srManager')}: —
                      </span>
                      <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                    </div>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {orphanTeams.map((team) => (
                        <TeamCardComponent key={team.jrManager?.id} team={team} toggling={toggling} onToggle={handleToggleActive} t={t} />
                      ))}
                    </div>
                  </div>
                )}

                {unassignedAgents.length > 0 && (
                  <div>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                      <span className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        {t('roster.unassigned')}
                      </span>
                      <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                    </div>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-50 dark:border-gray-800" style={{ backgroundColor: 'var(--primary-light)' }}>
                          <p className="text-xs font-bold text-gray-800 dark:text-gray-100">{t('roster.unassignedTeam')}</p>
                        </div>
                        <div className="divide-y divide-gray-50 dark:divide-gray-800">
                          {unassignedAgents.map((a) => (
                            <AgentRow key={a.id} agent={a} toggling={toggling} onToggle={handleToggleActive} t={t} />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit user modal */}
      {editing && (
        <EditUserModal
          key={editing.id}
          user={editing}
          users={users}
          viewerRole={viewerRole}
          ceoExists={ceoExists}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); fetchUsers(); }}
          t={t}
          lang={lang}
        />
      )}
    </AppLayout>
  );
}

// ─── Edit user modal ─────────────────────────────────────────────────────────
function EditUserModal({ user, users, viewerRole, ceoExists, onClose, onSaved, t, lang }: {
  user: User;
  users: User[];
  viewerRole: UserRole;
  ceoExists: boolean;
  onClose: () => void;
  onSaved: () => void;
  t: (k: string) => string;
  lang: string;
}) {
  const isCeoViewer = viewerRole === 'ceo';
  const ceoViewingAdmin = isCeoViewer && user.role === 'admin';

  const initialSr = (() => {
    if (user.role === 'jr_manager') return user.manager_id ?? '';
    if (user.role === 'agent' && user.manager_id) {
      const mgr = users.find((u) => u.id === user.manager_id);
      if (!mgr) return '';
      if (mgr.role === 'sr_manager') return mgr.id;
      if (mgr.role === 'jr_manager') return mgr.manager_id ?? '';
    }
    return '';
  })();

  const initialMgr = (() => {
    if (user.role !== 'agent' || !user.manager_id) return user.manager_id ?? '';
    const mgr = users.find((u) => u.id === user.manager_id);
    if (mgr?.role === 'jr_manager') return user.manager_id;
    return '';
  })();

  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email ?? '');
  const [role, setRole] = useState<UserRole>(user.role);
  const [hireDate, setHireDate] = useState(user.hire_date);
  const [srManager, setSrManager] = useState(initialSr);
  const [managerId, setManagerId] = useState(initialMgr);
  const [isActive, setIsActive] = useState(user.is_active);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [resetResult, setResetResult] = useState<{ tempPassword: string; emailSent: boolean } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(''); setSaveSuccess(false); setSaving(true);

    const resolvedManagerId = role === 'agent' ? (managerId || srManager || null)
      : role === 'jr_manager' ? (srManager || null)
      : null;

    const payload: Record<string, unknown> = {
      id: user.id, name, email: email || null, role,
      hire_date: hireDate, is_active: isActive,
      manager_id: resolvedManagerId,
    };

    try {
      const res = await fetch('/api/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const d = await res.json().catch(() => ({}));
      setSaving(false);
      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => onSaved(), 800);
      } else {
        setError(d.error || 'Error');
      }
    } catch (err) {
      setSaving(false);
      setError(err instanceof Error ? err.message : 'Network error');
    }
  }

  async function handleReset() {
    if (!confirm(t('admin.resetPasswordConfirm'))) return;
    setSaving(true); setError('');
    const res = await fetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: user.id, resetPassword: true, email }),
    });
    setSaving(false);
    if (res.ok) {
      const d = await res.json();
      setResetResult({ tempPassword: d.tempPassword, emailSent: d.emailSent });
    } else {
      setError(t('admin.resetPasswordError'));
    }
  }

  async function handleSetPassword() {
    setPwError(''); setPwSuccess(false);
    if (newPassword !== confirmPassword) { setPwError(t('auth.errorMismatch')); return; }
    if (newPassword.length < 6) { setPwError(t('auth.errorMinLength')); return; }
    setPwSaving(true);
    const res = await fetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: user.id, password: newPassword, must_change_password: false }),
    });
    setPwSaving(false);
    if (res.ok) {
      setPwSuccess(true);
      setNewPassword(''); setConfirmPassword('');
    } else {
      const d = await res.json().catch(() => ({}));
      setPwError(d.error || 'Error');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 dark:text-gray-100">{t('admin.editUser')}</h3>
          <div className="flex items-center gap-3">
            {user.role !== 'admin' && !ceoViewingAdmin && (
              <ToggleSwitch checked={isActive} onChange={setIsActive} size="md" />
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>
        </div>
        {ceoViewingAdmin && (
          <div className="mx-5 mt-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">⚠ {t('admin.cannotEditAdmin')}</p>
          </div>
        )}
        <form onSubmit={handleSave} className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('admin.username')}</label>
            <p className="text-sm text-gray-500 dark:text-gray-400">@{user.username}</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('admin.fullName')}</label>
            <input type="text" value={name} required onChange={(e) => setName(e.target.value)}
              disabled={ceoViewingAdmin}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm disabled:opacity-60" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('admin.emailLabel')}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              disabled={ceoViewingAdmin}
              placeholder="correo@watt.com"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm disabled:opacity-60" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('admin.hireDate')}</label>
            <input type="date" value={hireDate} required onChange={(e) => setHireDate(e.target.value)}
              disabled={ceoViewingAdmin}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm disabled:opacity-60" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('admin.role')}</label>
            <select value={role} onChange={(e) => { setRole(e.target.value as UserRole); setManagerId(''); setSrManager(''); }}
              disabled={ceoViewingAdmin}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm disabled:opacity-60">
              <option value="agent">{t('admin.roleAgent')}</option>
              <option value="jr_manager">{t('admin.roleJrManager')}</option>
              <option value="sr_manager">{t('admin.roleSrManager')}</option>
              <option value="ceo" disabled={ceoExists && user.role !== 'ceo'}>{t('admin.roleCeo')}{ceoExists && user.role !== 'ceo' ? ` (${t('common.alreadyExists')})` : ''}</option>
              {user.role === 'admin' && <option value="admin">{t('admin.roleAdmin')}</option>}
            </select>
          </div>
          {role === 'agent' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('admin.srManagerFilter')}</label>
                <select value={srManager} onChange={(e) => { setSrManager(e.target.value); setManagerId(''); }}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm">
                  <option value="">{t('admin.noSrManager')}</option>
                  {users.filter((u) => u.role === 'sr_manager').map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('admin.roleJrManager')}</label>
                <select value={managerId} onChange={(e) => setManagerId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm">
                  <option value="">{t('admin.noJrManager')}</option>
                  {users.filter((u) => u.role === 'jr_manager' && (!srManager || u.manager_id === srManager)).map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}
          {role === 'jr_manager' && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('admin.roleSrManager')}</label>
              <select value={srManager} onChange={(e) => setSrManager(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm">
                <option value="">{t('admin.noSrManager')}</option>
                {users.filter((u) => u.role === 'sr_manager').map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}

          {error && <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{error}</p>}
          {saveSuccess && <p className="text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-xl px-3 py-2">✓ {t('admin.savedSuccess')}</p>}

          {resetResult && (
            <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-3 space-y-1">
              <p className="text-xs font-bold text-green-700 dark:text-green-300">✓ {t('admin.resetPasswordSuccess')}</p>
              <code className="block bg-white dark:bg-gray-800 px-2 py-1.5 rounded text-sm font-mono font-bold text-gray-800 dark:text-gray-100 select-all">{resetResult.tempPassword}</code>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {resetResult.emailSent ? `📧 ${t('admin.tempPasswordSent')}` : `⚠ ${t('admin.tempPasswordManual')}`}
              </p>
            </div>
          )}

          {!ceoViewingAdmin && (
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={handleReset} disabled={saving}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-xs hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60">
                🔑 {t('admin.resetPasswordBtn')}
              </button>
              <button type="submit" disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-white font-bold text-sm disabled:opacity-60"
                style={{ backgroundColor: 'var(--primary)' }}>
                {saving ? t('common.saving') : t('common.save')}
              </button>
            </div>
          )}
        </form>

        {viewerRole === 'admin' && (
          <div className="px-5 pb-5 space-y-3">
            <div className="h-px bg-gray-200 dark:bg-gray-700" />
            <h4 className="font-bold text-gray-800 dark:text-gray-100 text-sm">{t('admin.setPasswordTitle')}</h4>
            <div className="relative">
              <input
                type={showNewPw ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('auth.newPassword')}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm pr-20"
              />
              <button type="button" onClick={() => setShowNewPw(!showNewPw)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                {showNewPw ? t('auth.hidePassword') : t('auth.showPassword')}
              </button>
            </div>
            <div className="relative">
              <input
                type={showConfirmPw ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('auth.confirmPassword')}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm pr-20"
              />
              <button type="button" onClick={() => setShowConfirmPw(!showConfirmPw)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                {showConfirmPw ? t('auth.hidePassword') : t('auth.showPassword')}
              </button>
            </div>
            {pwError && <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{pwError}</p>}
            {pwSuccess && <p className="text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-xl px-3 py-2">✓ {t('admin.passwordSetSuccess')}</p>}
            <button type="button" onClick={handleSetPassword} disabled={pwSaving || !newPassword}
              className="w-full py-2.5 rounded-xl border-2 border-[var(--primary)] font-bold text-sm disabled:opacity-60"
              style={{ color: 'var(--primary)' }}>
              {pwSaving ? t('common.saving') : t('admin.setPasswordBtn')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
