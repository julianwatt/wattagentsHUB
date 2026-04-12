'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Session } from 'next-auth';
import { useLanguage } from './LanguageContext';
import { useTheme } from './ThemeContext';
import { usePreviewRole, Role } from './PreviewRoleContext';
import WattLogo from './WattLogo';

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

export default function AppLayout({ session, children }: Props) {
  const pathname = usePathname();
  const { t, lang, setLang } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { realRole, previewRole, effectiveRole, setPreviewRole } = usePreviewRole();
  const realIsAdmin = (realRole ?? session.user.role) === 'admin';
  const role = (effectiveRole ?? session.user.role) as Role;
  const canSeeAdmin = role === 'admin' || role === 'ceo';
  const canSeeTeam = role === 'jr_manager' || role === 'sr_manager' || role === 'ceo';
  const isAdminReal = realRole === 'admin' || (realRole ?? session.user.role) === 'admin';
  const allNav = [
    ...BASE_NAV.filter((item) => !(item.hideForAdmin && isAdminReal && !previewRole)),
    ...(canSeeTeam ? [TEAM_NAV] : []),
    ...(canSeeAdmin ? [ADMIN_NAV] : []),
  ];

  const roleLabel =
    role === 'admin' ? t('nav.administrator')
    : role === 'ceo' ? t('nav.ceo')
    : role === 'sr_manager' ? t('admin.roleSrManager')
    : role === 'jr_manager' ? t('admin.roleJrManager')
    : t('nav.agent');

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col transition-colors">
      {/* Preview-mode banner (admin only, when previewing as another role) */}
      {realIsAdmin && previewRole && (
        <div className="sticky top-0 z-50 bg-amber-400 text-amber-950 text-xs font-bold px-3 sm:px-6 py-1.5 flex items-center justify-between gap-3 shadow-sm">
          <span className="flex items-center gap-2 truncate">
            <span aria-hidden>👁️</span>
            <span className="truncate">
              {lang === 'es' ? 'Modo vista previa como' : 'Previewing as'}{' '}
              <span className="uppercase">{roleLabel}</span>
            </span>
          </span>
          <button
            onClick={() => setPreviewRole(null)}
            className="px-2.5 py-1 rounded-md bg-amber-950 text-amber-50 hover:bg-amber-900 transition-colors flex-shrink-0"
          >
            {lang === 'es' ? 'Salir de vista previa' : 'Exit preview'}
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
            {/* Preview-as selector — admin only, visible on all screens */}
            {realIsAdmin && (
              <select
                value={previewRole ?? ''}
                onChange={(e) => setPreviewRole((e.target.value || null) as Role | null)}
                title={lang === 'es' ? 'Vista previa como rol' : 'Preview as role'}
                className="h-8 px-1 sm:px-2 rounded-lg text-[10px] sm:text-[11px] font-bold bg-white/10 text-white hover:bg-white/20 border border-white/20 focus:outline-none focus:ring-2 focus:ring-white/40 max-w-[110px] sm:max-w-[140px]"
              >
                <option value="" className="text-gray-900">
                  {lang === 'es' ? '👁️ Ver como…' : '👁️ View as…'}
                </option>
                <option value="agent" className="text-gray-900">{t('admin.roleAgent')}</option>
                <option value="jr_manager" className="text-gray-900">{t('admin.roleJrManager')}</option>
                <option value="sr_manager" className="text-gray-900">{t('admin.roleSrManager')}</option>
                <option value="ceo" className="text-gray-900">{t('admin.roleCeo')}</option>
              </select>
            )}
            {/* Dark mode toggle */}
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              {theme === 'dark' ? <SunIcon className="w-4 h-4" /> : <MoonIcon className="w-4 h-4" />}
            </button>

            {/* Language toggle */}
            <button
              onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
              className="h-8 px-2 rounded-lg text-xs font-bold text-white/70 hover:text-white hover:bg-white/10 transition-colors border border-white/20"
            >
              {lang === 'es' ? 'EN' : 'ES'}
            </button>

            {/* User + logout */}
            <div className="flex items-center gap-2 pl-1 border-l border-white/20 ml-1">
              <div className="text-right leading-none">
                <p className="text-xs font-semibold text-white max-w-[80px] sm:max-w-[100px] truncate">{session.user.name}</p>
                <p className="text-[10px] text-white/50 hidden sm:block">{roleLabel}</p>
              </div>
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
      </header>

      {/* Main content with bottom padding on mobile for tab bar */}
      <main className="flex-1 pb-16 md:pb-0 min-h-0">
        {children}
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 z-40 safe-area-bottom">
        <div className="flex">
          {allNav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] font-semibold transition-colors ${
                  active ? '' : 'text-gray-400 dark:text-gray-500'
                }`}
                style={active ? { color: 'var(--primary)' } : {}}
              >
                <Icon className="w-5 h-5" />
                <span>{t(item.key)}</span>
              </Link>
            );
          })}
        </div>
      </nav>
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
