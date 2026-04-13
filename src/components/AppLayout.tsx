'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Session } from 'next-auth';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useLanguage } from './LanguageContext';
import { useTheme } from './ThemeContext';
import { usePreviewRole, Role } from './PreviewRoleContext';
import { fmtDate } from '@/lib/i18n';
import WattLogo from './WattLogo';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

interface Props {
  session: Session;
  children: React.ReactNode;
}

const BASE_NAV = [
  { href: '/activity', icon: ActivityIcon, key: 'nav.activity', hideForAdmin: true },
  { href: '/simulator', icon: SimIcon, key: 'nav.simulator' },
  { href: '/dashboard', icon: DashIcon, key: 'nav.dashboard' },
];
const TEAM_NAV = { href: '/team', icon: TeamIcon, key: 'nav.team' };
const ADMIN_NAV = { href: '/admin', icon: AdminIcon, key: 'nav.admin' };
const ROSTER_NAV = { href: '/roster', icon: RosterIcon, key: 'nav.roster' };
const NOTIF_NAV = { href: '/notifications', icon: NotifNavIcon, key: 'admin.notifications' };

export default function AppLayout({ session, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, lang, setLang } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { realRole, previewRole, previewUserId, previewUserName, effectiveRole, setPreviewRole, setPreviewUser } = usePreviewRole();

  // ── Fetch real user name + hire_date from DB ──
  const [dbUserName, setDbUserName] = useState<string>(session.user.name ?? '');
  const [hireDate, setHireDate] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const sb = getSupabaseBrowser();
        const { data } = await sb
          .from('users')
          .select('name, hire_date')
          .eq('id', session.user.id)
          .single();
        if (data) {
          if (data.name) setDbUserName(data.name);
          if (data.hire_date) setHireDate(data.hire_date);
        }
      } catch {}
    })();
  }, [session.user.id, session.user.name]);

  // Fetch active users for "Ver como" individual selection
  interface PreviewUser { id: string; name: string; role: string; }
  const [previewUsers, setPreviewUsers] = useState<PreviewUser[]>([]);
  useEffect(() => {
    if (realRole !== 'admin' && (realRole ?? session.user.role) !== 'admin') return;
    (async () => {
      try {
        const res = await fetch('/api/users');
        if (res.ok) {
          const data = await res.json();
          setPreviewUsers(
            (data as PreviewUser[])
              .filter((u: PreviewUser & { is_active?: boolean }) => u.is_active !== false && u.role !== 'admin')
              .sort((a: PreviewUser, b: PreviewUser) => a.name.localeCompare(b.name)),
          );
        }
      } catch {}
    })();
  }, [realRole, session.user.role]);

  // Navigate to appropriate page when preview role changes
  const handlePreviewChange = (value: string) => {
    if (!value) {
      setPreviewUser(null, null, null);
      setPreviewRole(null);
      router.push('/admin');
      return;
    }
    if (value.startsWith('user:')) {
      const userId = value.slice(5);
      const u = previewUsers.find((p) => p.id === userId);
      if (u) {
        setPreviewUser(u.id, u.role as Role, u.name);
        if (u.role === 'agent') router.push('/activity');
        else if (u.role === 'ceo') router.push('/dashboard');
        else router.push('/activity');
      }
      return;
    }
    const newRole = value as Role;
    setPreviewRole(newRole);
    if (newRole === 'agent') router.push('/activity');
    else if (newRole === 'jr_manager' || newRole === 'sr_manager') router.push('/activity');
    else if (newRole === 'ceo') router.push('/dashboard');
  };

  const realIsAdmin = (realRole ?? session.user.role) === 'admin';
  const role = (effectiveRole ?? session.user.role) as Role;
  const canSeeAdmin = role === 'admin' || role === 'ceo';
  const canSeeTeam = role === 'jr_manager' || role === 'sr_manager' || role === 'ceo';
  const isAdminReal = realRole === 'admin' || (realRole ?? session.user.role) === 'admin';
  const allNav = [
    ...BASE_NAV.filter((item) => !(item.hideForAdmin && isAdminReal && !previewRole)),
    ...(canSeeTeam ? [TEAM_NAV] : []),
    ...(isAdminReal && !previewRole ? [ROSTER_NAV] : []),
    ...(isAdminReal && !previewRole ? [NOTIF_NAV] : []),
    ...(canSeeAdmin ? [ADMIN_NAV] : []),
  ];

  // ── Notification bell (admin only) ──
  interface NotifItem { id: string; type: string; user_name?: string; user_username?: string; status: string; created_at: string; }
  const notifTypeLabel = (type: string) => {
    if (type === 'password_reset') return lang === 'es' ? 'Reseteo de contraseña' : 'Password reset';
    if (type === 'password_change') return lang === 'es' ? 'Cambio de contraseña' : 'Password change';
    if (type === 'user_deactivated') return lang === 'es' ? 'Usuario desactivado' : 'User deactivated';
    return type;
  };
  const notifBadgeColor = (type: string) => {
    if (type === 'password_reset') return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
    if (type === 'password_change') return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300';
    if (type === 'user_deactivated') return 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300';
    return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300';
  };
  const notifPreviewText = (n: NotifItem) => {
    if (n.type === 'password_reset') return `${n.user_name ?? '—'} ${t('admin.notifPreviewReset')}`;
    if (n.type === 'password_change') return `${n.user_name ?? '—'} ${t('admin.notifPreviewChange')}`;
    if (n.type === 'user_deactivated') return `${n.user_name ?? '—'} ${t('admin.notifPreviewDeactivated')}`;
    return n.user_name ?? '—';
  };
  const [notifItems, setNotifItems] = useState<NotifItem[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const pendingCount = notifItems.filter((n) => n.status === 'pending').length;

  const fetchNotifs = useCallback(async () => {
    if (!isAdminReal || previewRole) return;
    try {
      const res = await fetch('/api/notifications');
      if (res.ok) {
        const data = await res.json();
        setNotifItems(data.notifications ?? []);
      }
    } catch {}
  }, [isAdminReal, previewRole]);

  useEffect(() => {
    fetchNotifs();
    if (!isAdminReal || previewRole) return;
    const sb = getSupabaseBrowser();
    const channel = sb.channel('admin-notifs').on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'admin_notifications' },
      () => { fetchNotifs(); },
    ).subscribe();
    return () => { sb.removeChannel(channel); };
  }, [fetchNotifs, isAdminReal, previewRole]);

  // Close bell dropdown on outside click
  useEffect(() => {
    function onClickOut(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setNotifOpen(false);
    }
    document.addEventListener('mousedown', onClickOut);
    return () => document.removeEventListener('mousedown', onClickOut);
  }, []);

  // ── Hamburger menu state ──
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close hamburger on outside click
  useEffect(() => {
    function onClickOut(e: MouseEvent) {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOut);
    return () => document.removeEventListener('mousedown', onClickOut);
  }, [menuOpen]);

  // Close hamburger on route change
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const roleLabel =
    role === 'admin' ? t('nav.administrator')
    : role === 'ceo' ? t('nav.ceo')
    : role === 'sr_manager' ? t('admin.roleSrManager')
    : role === 'jr_manager' ? t('admin.roleJrManager')
    : t('nav.agent');

  // ── Tenure calculation ──
  const tenureText = (() => {
    if (!hireDate) return '';
    const start = new Date(hireDate);
    const now = new Date();
    const diffMs = now.getTime() - start.getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (days < 14) return `${days} ${t('nav.tenureDays')}`;
    const weeks = Math.floor(days / 7);
    if (days < 90) return `${weeks} ${t('nav.tenureWeeks')}`;
    const months = Math.floor(days / 30.44);
    if (months < 24) return `${months} ${t('nav.tenureMonths')}`;
    const years = (days / 365.25).toFixed(1);
    return `${years} ${t('nav.tenureYears')}`;
  })();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col transition-colors">
      {/* Preview-mode banner (admin only, when previewing as another role) */}
      {realIsAdmin && previewRole && (
        <div className="sticky top-0 z-50 bg-amber-400 text-amber-950 text-xs font-bold px-3 sm:px-6 py-1.5 flex items-center justify-between gap-3 shadow-sm">
          <span className="flex items-center gap-2 truncate">
            <span aria-hidden>👁️</span>
            <span className="truncate">
              {t('admin.previewingAs')}{' '}
              <span className="uppercase">{previewUserName ? `${previewUserName} (${roleLabel})` : roleLabel}</span>
            </span>
          </span>
          <button
            onClick={() => handlePreviewChange('')}
            className="px-2.5 py-1 rounded-md bg-amber-950 text-amber-50 hover:bg-amber-900 transition-colors flex-shrink-0"
          >
            {t('admin.exitPreview')}
          </button>
        </div>
      )}

      {/* Top navbar */}
      <header className="sticky z-40 shadow-sm" style={{ backgroundColor: 'var(--dark)', top: realIsAdmin && previewRole ? '32px' : 0 }}>
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between gap-2">
          {/* Logo */}
          <div className="flex items-center flex-shrink-0" style={{ height: '36px' }}>
            <WattLogo className="h-full w-auto" />
          </div>

          {/* Desktop nav links */}
          <nav className="hidden md:flex items-center gap-1">
            {allNav.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? 'text-white'
                      : 'text-white/70 hover:text-white hover:bg-white/10'
                  }`}
                  style={active ? { backgroundColor: 'var(--primary)' } : {}}
                >
                  <Icon className="w-4 h-4" />
                  {t(item.key)}
                </Link>
              );
            })}
          </nav>

          {/* Controls */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Preview-as selector — admin only, desktop only */}
            {realIsAdmin && (
              <select
                value={previewUserId ? `user:${previewUserId}` : (previewRole ?? '')}
                onChange={(e) => handlePreviewChange(e.target.value)}
                title={t('admin.viewAs')}
                className="hidden md:block h-8 px-2 rounded-lg text-[11px] font-bold bg-white/10 text-white hover:bg-white/20 border border-white/20 focus:outline-none focus:ring-2 focus:ring-white/40 max-w-[180px]"
              >
                <option value="" className="text-gray-900">
                  👁️ {t('admin.viewAs')}
                </option>
                <optgroup label={lang === 'es' ? '— Roles —' : '— Roles —'} className="text-gray-900">
                  <option value="agent" className="text-gray-900">{t('admin.roleAgent')}</option>
                  <option value="jr_manager" className="text-gray-900">{t('admin.roleJrManager')}</option>
                  <option value="sr_manager" className="text-gray-900">{t('admin.roleSrManager')}</option>
                  <option value="ceo" className="text-gray-900">{t('admin.roleCeo')}</option>
                </optgroup>
                {previewUsers.length > 0 && (
                  <optgroup label={lang === 'es' ? '— Usuarios —' : '— Users —'} className="text-gray-900">
                    {previewUsers.map((u) => (
                      <option key={u.id} value={`user:${u.id}`} className="text-gray-900">
                        {u.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            )}

            {/* Language toggle */}
            <button
              onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
              className="h-8 px-2 rounded-lg text-xs font-bold text-white/70 hover:text-white hover:bg-white/10 transition-colors border border-white/20"
            >
              {lang === 'es' ? 'EN' : 'ES'}
            </button>

            {/* Notification bell (admin only) */}
            {isAdminReal && !previewRole && (
              <div ref={bellRef} className="relative">
                <button
                  onClick={() => setNotifOpen(!notifOpen)}
                  title={t('admin.notifBellTitle')}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors relative"
                >
                  <BellIcon className="w-4 h-4" />
                  {pendingCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center leading-none">
                      {pendingCount > 9 ? '9+' : pendingCount}
                    </span>
                  )}
                </button>
                {notifOpen && (
                  <div className="absolute right-0 top-10 w-72 sm:w-80 bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                      <h4 className="text-xs font-bold text-gray-800 dark:text-gray-100">{t('admin.notifBellTitle')}</h4>
                      {pendingCount > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300">{pendingCount}</span>}
                    </div>
                    <div className="max-h-64 overflow-y-auto divide-y divide-gray-50 dark:divide-gray-800">
                      {notifItems.length === 0 ? (
                        <p className="text-xs text-gray-400 px-4 py-4 text-center">{t('admin.notifEmpty')}</p>
                      ) : notifItems.slice(0, 5).map((n) => (
                        <div key={n.id} className={`px-4 py-2.5 ${n.status === 'pending' ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${notifBadgeColor(n.type)}`}>
                                  {notifTypeLabel(n.type)}
                                </span>
                                <span className="text-[10px] text-gray-400">{fmtDate(n.created_at, lang)}</span>
                              </div>
                              <p className="text-xs text-gray-600 dark:text-gray-300 truncate leading-snug">{notifPreviewText(n)}</p>
                              <p className="text-[10px] text-gray-400">@{n.user_username}</p>
                            </div>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 mt-0.5 ${n.status === 'pending' ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300' : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'}`}>
                              {n.status === 'pending' ? '!' : '✓'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <Link href="/notifications" onClick={() => setNotifOpen(false)}
                      className="block px-4 py-2 text-center text-[11px] font-semibold border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                      style={{ color: 'var(--primary)' }}>
                      {t('admin.notifViewAll')}
                    </Link>
                  </div>
                )}
              </div>
            )}

            {/* Dark mode toggle */}
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              {theme === 'dark' ? <SunIcon className="w-4 h-4" /> : <MoonIcon className="w-4 h-4" />}
            </button>

            {/* Hamburger button — mobile only */}
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              aria-label={t('nav.menu')}
            >
              <HamburgerIcon className="w-5 h-5" />
            </button>

            {/* Desktop: User name + logout */}
            <div className="hidden md:flex items-center gap-2 pl-1 border-l border-white/20 ml-1">
              <div className="text-right leading-none">
                <p className="text-xs font-semibold text-white max-w-[100px] truncate">{dbUserName || session.user.name}</p>
                <p className="text-[10px] text-white/50">{roleLabel}</p>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                title={t('nav.logout')}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-white/70 hover:bg-red-500/20 hover:text-red-300 transition-colors"
              >
                <LogoutIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ── Mobile slide-out hamburger menu ── */}
      {/* Overlay */}
      <div
        className={`md:hidden fixed inset-0 z-50 bg-black/40 transition-opacity duration-300 ${menuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setMenuOpen(false)}
      />
      {/* Panel */}
      <div
        ref={menuRef}
        className={`md:hidden fixed top-0 right-0 z-50 h-full w-72 bg-white dark:bg-gray-900 shadow-2xl transform transition-transform duration-300 ease-in-out ${menuOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Close button */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('nav.menu')}</span>
          <button
            onClick={() => setMenuOpen(false)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* User info card */}
        <div className="mx-4 mb-4 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800">
          <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{dbUserName || session.user.name}</p>
          <p className="text-[11px] font-semibold mt-0.5" style={{ color: 'var(--primary)' }}>{roleLabel}</p>
          {tenureText && (
            <p className="text-[10px] text-gray-400 mt-0.5">{tenureText}</p>
          )}
        </div>

        {/* "Ver como" selector — admin only, inside hamburger */}
        {realIsAdmin && (
          <div className="mx-4 mb-3">
            <select
              value={previewUserId ? `user:${previewUserId}` : (previewRole ?? '')}
              onChange={(e) => { handlePreviewChange(e.target.value); setMenuOpen(false); }}
              className="w-full h-9 px-2 rounded-xl text-[11px] font-bold bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            >
              <option value="">👁️ {t('admin.viewAs')}</option>
              <optgroup label={lang === 'es' ? '— Roles —' : '— Roles —'}>
                <option value="agent">{t('admin.roleAgent')}</option>
                <option value="jr_manager">{t('admin.roleJrManager')}</option>
                <option value="sr_manager">{t('admin.roleSrManager')}</option>
                <option value="ceo">{t('admin.roleCeo')}</option>
              </optgroup>
              {previewUsers.length > 0 && (
                <optgroup label={lang === 'es' ? '— Usuarios —' : '— Users —'}>
                  {previewUsers.map((u) => (
                    <option key={u.id} value={`user:${u.id}`}>{u.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        )}

        {/* Nav links */}
        <nav className="px-2 space-y-0.5">
          {allNav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  active
                    ? 'text-white'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                style={active ? { backgroundColor: 'var(--primary)' } : {}}
              >
                <Icon className="w-5 h-5" />
                {t(item.key)}
              </Link>
            );
          })}
        </nav>

        {/* Logout at bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-100 dark:border-gray-800 safe-area-bottom">
          <button
            onClick={() => { signOut({ callbackUrl: '/login' }); setMenuOpen(false); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <LogoutIcon className="w-5 h-5" />
            {t('nav.logout')}
          </button>
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 min-h-0">
        {children}
      </main>
    </div>
  );
}

// SVG icons
function SimIcon({ className }: { className: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>;
}
function ActivityIcon({ className }: { className: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>;
}
function DashIcon({ className }: { className: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>;
}
function AdminIcon({ className }: { className: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>;
}
function TeamIcon({ className }: { className: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>;
}
function SunIcon({ className }: { className: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" /></svg>;
}
function MoonIcon({ className }: { className: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>;
}
function LogoutIcon({ className }: { className: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>;
}
function BellIcon({ className }: { className: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>;
}
function NotifNavIcon({ className }: { className: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>;
}
function RosterIcon({ className }: { className: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>;
}
function HamburgerIcon({ className }: { className: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>;
}
function CloseIcon({ className }: { className: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;
}
