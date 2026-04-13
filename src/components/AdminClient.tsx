'use client';
import { useState, useEffect, FormEvent } from 'react';
import { Session } from 'next-auth';
import AppLayout from './AppLayout';
import { useLanguage } from './LanguageContext';
import ToggleSwitch from './ToggleSwitch';
// Theme picker removed — Watt Gold only


type UserRole = 'agent' | 'jr_manager' | 'sr_manager' | 'admin' | 'ceo';
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

const today = () => new Date().toISOString().slice(0, 10);

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

interface CreatedUserInfo { username: string; name: string; tempPassword: string; emailSent: boolean; email: string | null; }

export default function AdminClient({ session }: { session: Session }) {
  const { t, lang } = useLanguage();
  // Theme picker removed
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const viewerRole = session.user.role as UserRole;
  const isCeoViewer = viewerRole === 'ceo';
  const ceoExists = users.some((u) => u.role === 'ceo');

  const [form, setForm] = useState({
    username: '', name: '', email: '',
    role: 'agent' as UserRole,
    manager_id: '', sr_manager_filter: '',
    hire_date: today(),
  });
  const [formError, setFormError] = useState('');
  const [created, setCreated] = useState<CreatedUserInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Theme state removed
  const [editing, setEditing] = useState<User | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
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

  const fetchUsers = async () => {
    setLoading(true);
    const res = await fetch('/api/users');
    if (res.ok) setUsers(await res.json());
    setLoading(false);
  };
  useEffect(() => { fetchUsers(); }, []);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(''); setCreated(null); setSubmitting(true);
    const { sr_manager_filter: srFilter, ...formData } = form;
    // For agents: prefer jr_manager, fallback to sr_manager (direct report)
    // For jr_managers: manager_id is already the sr_manager from the form
    const resolvedMgr = formData.role === 'agent'
      ? (formData.manager_id || srFilter || null)
      : (formData.manager_id || null);
    const payload = {
      ...formData,
      manager_id: resolvedMgr,
      email: formData.email || null,
    };
    console.log('[handleAdd] manager_id resolution:', { role: formData.role, jrManager: formData.manager_id, srFilter, resolved: resolvedMgr });
    const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    setSubmitting(false);
    if (res.ok) {
      const data = await res.json();
      setCreated({
        username: data.username,
        name: data.name,
        tempPassword: data.tempPassword,
        emailSent: data.emailSent,
        email: data.email,
      });
      setForm({ username: '', name: '', email: '', role: 'agent', manager_id: '', sr_manager_filter: '', hire_date: today() });
      fetchUsers();
    } else {
      const d = await res.json();
      setFormError(d.error || 'Error');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`${t('admin.deleteConfirm')} "${name}"?`)) return;
    const res = await fetch('/api/users', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    if (res.ok) fetchUsers();
  };

  // Theme change handler removed

  return (
    <AppLayout session={session}>
      <div className="max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-6 overflow-x-hidden">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{t('admin.title')}</h1>
        </div>

        {/* Theme picker removed — Watt Gold is the only active theme */}

        <div className="grid md:grid-cols-3 gap-5 min-w-0">
          {/* Add user form */}
          <div className="md:col-span-1">
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-3 sm:p-5">
              <h3 className="font-bold text-gray-800 dark:text-gray-100 mb-5 flex items-center gap-2 text-sm">
                <svg className="w-4 h-4" style={{ color: 'var(--primary)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
                {t('admin.addUser')}
              </h3>
              <form onSubmit={handleAdd} className="space-y-3">
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
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{t('admin.hireDate')}</label>
                  <input type="date" value={form.hire_date} required onChange={(e) => setForm({ ...form, hire_date: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm" />
                </div>
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
                        {users
                          .filter((u) => u.role === 'jr_manager' && (!form.sr_manager_filter || u.manager_id === form.sr_manager_filter))
                          .map((u) => (
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
          <div className="md:col-span-2 space-y-4">
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
              <div className="px-3 sm:px-5 py-3 sm:py-4 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between">
                <h3 className="font-bold text-gray-800 dark:text-gray-100 text-sm">{t('admin.usersTable')}</h3>
                <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full px-2.5 py-0.5 font-semibold flex-shrink-0">{users.length}</span>
              </div>
              {loading ? (
                <div className="p-12 text-center text-gray-400 text-sm">{t('common.loading')}</div>
              ) : (
                <div className="divide-y divide-gray-50 dark:divide-gray-800">
                  {sortUsers(users).map((u) => (
                    <div key={u.id} className={`flex items-center justify-between px-3 sm:px-5 py-3 sm:py-4 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 ${!u.is_active ? 'opacity-50' : ''}`}>
                      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                        <div
                          className="w-7 h-7 sm:w-9 sm:h-9 rounded-full flex items-center justify-center font-bold text-xs sm:text-sm flex-shrink-0"
                          style={u.role === 'admin' || u.role === 'ceo'
                            ? { backgroundColor: 'var(--dark-light)', color: 'var(--dark)' }
                            : { backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}
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
            </div>

            {/* storageNotice removed */}
          </div>
        </div>
      </div>

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

// ────────────────────────────────────────────────────────
// Edit user modal
// ────────────────────────────────────────────────────────
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

  // Resolve initial Sr Manager and Jr Manager based on who the agent's manager_id points to
  const initialSr = (() => {
    if (user.role === 'jr_manager') return user.manager_id ?? '';
    if (user.role === 'agent' && user.manager_id) {
      const mgr = users.find((u) => u.id === user.manager_id);
      if (!mgr) return '';
      // Agent reports directly to a sr_manager (no jr_manager in between)
      if (mgr.role === 'sr_manager') return mgr.id;
      // Agent reports to a jr_manager → sr_manager is the jr's manager
      if (mgr.role === 'jr_manager') return mgr.manager_id ?? '';
    }
    return '';
  })();

  // managerId should only hold a jr_manager's id; if agent reports directly to sr, it's empty
  const initialMgr = (() => {
    if (user.role !== 'agent' || !user.manager_id) return user.manager_id ?? '';
    const mgr = users.find((u) => u.id === user.manager_id);
    if (mgr?.role === 'jr_manager') return user.manager_id;
    return ''; // sr_manager or unknown → no jr_manager assigned
  })();

  console.log('[EditUserModal] init:', { userId: user.id, userName: user.name, role: user.role, dbManagerId: user.manager_id, initialSr, initialMgr });

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

    // Log raw state values BEFORE building payload
    console.log('[EditUserModal] State before save:', { role, managerId, srManager, name, email, hireDate, isActive });

    // For agents: prefer jr_manager, fallback to sr_manager (direct report if no jr assigned)
    // For jr_managers: use sr_manager
    const resolvedManagerId = role === 'agent' ? (managerId || srManager || null)
      : role === 'jr_manager' ? (srManager || null)
      : null;

    const payload: Record<string, unknown> = {
      id: user.id,
      name,
      email: email || null,
      role,
      hire_date: hireDate,
      is_active: isActive,
      manager_id: resolvedManagerId,
    };

    console.log('[EditUserModal] manager_id resolution:', { role, managerId, srManager, resolvedManagerId, managerIdType: typeof managerId, resolvedType: typeof resolvedManagerId });
    console.log('[EditUserModal] Full payload:', JSON.stringify(payload, null, 2));

    try {
      const res = await fetch('/api/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const d = await res.json().catch(() => ({}));
      console.log('[EditUserModal] API response:', res.status, JSON.stringify(d));
      setSaving(false);
      if (res.ok) {
        // Verify the change persisted by re-fetching the user
        try {
          const verifyRes = await fetch('/api/users');
          if (verifyRes.ok) {
            const allUsers = await verifyRes.json();
            const updated = allUsers.find((u: { id: string }) => u.id === user.id);
            console.log('[EditUserModal] VERIFY after save — manager_id in DB:', updated?.manager_id, '| expected:', payload.manager_id);
            if (updated?.manager_id !== payload.manager_id) {
              console.warn('[EditUserModal] ⚠ manager_id MISMATCH! DB has:', updated?.manager_id, 'but sent:', payload.manager_id);
            }
          }
        } catch (verifyErr) {
          console.warn('[EditUserModal] Verify fetch failed:', verifyErr);
        }
        setSaveSuccess(true);
        setTimeout(() => onSaved(), 800);
      } else {
        const msg = d.error || 'Error';
        setError(msg);
        console.error('[EditUserModal] Save failed:', msg, d);
      }
    } catch (err) {
      setSaving(false);
      const msg = err instanceof Error ? err.message : 'Network error';
      setError(msg);
      console.error('[EditUserModal] Save error:', err);
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
