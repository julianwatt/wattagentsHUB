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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await signIn('credentials', { username, password, redirect: false });
    setLoading(false);
    if (res?.error) setError(t('auth.error'));
    else router.push('/activity');
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
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password"
                  placeholder={t('auth.passwordPlaceholder')}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] placeholder-gray-400 dark:placeholder-gray-500 transition-all" />
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

            <p className="mt-8 text-center text-xs text-gray-400 dark:text-gray-500">{t('auth.footer')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
