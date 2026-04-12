'use client';
import { useState, FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/components/LanguageContext';
import { useTheme } from '@/components/ThemeContext';
import WattLogo from '@/components/WattLogo';

export default function LoginPage() {
  const router = useRouter();
  const { t, lang, setLang } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSending, setForgotSending] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await signIn('credentials', { username, password, redirect: false });
    setLoading(false);
    if (res?.error) setError(t('auth.error'));
    else {
      // Admin goes to admin panel; others to activity
      router.push('/activity');
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center p-12 relative overflow-hidden" style={{ background: `linear-gradient(135deg, var(--dark), var(--dark-alt))` }}>
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-20 w-64 h-64 rounded-full blur-3xl" style={{ backgroundColor: 'var(--primary)' }} />
          <div className="absolute bottom-20 right-20 w-48 h-48 rounded-full blur-3xl" style={{ backgroundColor: 'var(--primary)' }} />
        </div>
        <div className="relative z-10 text-center">
          <div className="mb-8 flex items-center justify-center" style={{ fontSize: '2.4rem' }}>
            <WattLogo className="h-auto w-auto" bigW />
          </div>
          <p className="text-blue-200 text-base leading-relaxed max-w-xs mt-4">
            {t('auth.heroSubtitle')} <span className="text-white font-semibold">Watt Distributors</span>
          </p>
        </div>
      </div>

      {/* Right panel */}
      <div className="w-full lg:w-1/2 flex flex-col bg-white dark:bg-gray-900 transition-colors">
        {/* Top controls */}
        <div className="relative flex items-center p-4 sm:p-6">
          {/* Logo centered on mobile */}
          <div className="absolute left-1/2 -translate-x-1/2 lg:hidden rounded-xl px-3 py-1.5" style={{ backgroundColor: 'var(--dark)' }}>
            <WattLogo className="h-8 w-auto" />
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={toggleTheme}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              {theme === 'dark'
                ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" /></svg>
                : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>}
            </button>
            <button onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
              className="h-8 px-2 rounded-lg text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700 transition-colors">
              {lang === 'es' ? 'EN' : 'ES'}
            </button>
          </div>
        </div>

        {/* Form */}
        <div className="flex-1 flex items-center justify-center px-6 sm:px-12 py-8">
          <div className="w-full max-w-md">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 mb-1">{t('auth.login')}</h2>
            <p className="text-gray-500 dark:text-gray-400 mb-8 text-sm">{t('auth.loginSubtitle')}</p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">{t('auth.username')}</label>
                <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username"
                  placeholder={t('auth.usernamePlaceholder')}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] placeholder-gray-400 dark:placeholder-gray-500 transition-all" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">{t('auth.password')}</label>
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password"
                    placeholder={t('auth.passwordPlaceholder')}
                    className="w-full px-4 py-3 pr-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] placeholder-gray-400 dark:placeholder-gray-500 transition-all" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    title={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}>
                    {showPassword ? (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    )}
                  </button>
                </div>
              </div>
              {error && (
                <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-xl px-4 py-3 text-sm">
                  <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                  {error}
                </div>
              )}
              <button type="submit" disabled={loading}
                className="w-full py-3.5 px-6 rounded-xl text-white font-bold text-base transition-all disabled:opacity-60 shadow-lg mt-2"
                style={{ backgroundColor: 'var(--primary)' }}>
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    {t('auth.logging')}
                  </span>
                ) : t('auth.loginButton')}
              </button>
            </form>

            <div className="mt-4 text-center">
              <button type="button" onClick={() => { setShowForgot(true); setForgotEmail(''); setForgotSent(false); }}
                className="text-sm text-[var(--primary)] hover:underline font-medium">
                {t('auth.forgotPassword')}
              </button>
            </div>

            <p className="mt-6 text-center text-xs text-gray-400 dark:text-gray-500">{t('auth.footer')}</p>
          </div>
        </div>
      </div>
      {/* Forgot password modal */}
      {showForgot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowForgot(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">{t('auth.forgotPasswordTitle')}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t('auth.forgotPasswordDesc')}</p>
            {forgotSent ? (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 rounded-xl px-4 py-3 text-sm">
                ✓ {t('auth.forgotPasswordSent')}
              </div>
            ) : (
              <form onSubmit={async (e) => {
                e.preventDefault();
                setForgotSending(true);
                await fetch('/api/auth/forgot-password', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: forgotEmail }),
                });
                setForgotSending(false);
                setForgotSent(true);
              }} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Email</label>
                  <input type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} required
                    placeholder={lang === 'es' ? 'tu@correo.com' : 'your@email.com'}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-sm" />
                </div>
                <button type="submit" disabled={forgotSending}
                  className="w-full py-2.5 rounded-xl text-white font-bold text-sm disabled:opacity-60"
                  style={{ backgroundColor: 'var(--primary)' }}>
                  {forgotSending ? '...' : t('auth.forgotPasswordBtn')}
                </button>
              </form>
            )}
            <button type="button" onClick={() => setShowForgot(false)}
              className="w-full mt-3 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              {lang === 'es' ? 'Cerrar' : 'Close'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
