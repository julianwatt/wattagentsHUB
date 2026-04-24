'use client';
import { useState, FormEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useLanguage } from '@/components/LanguageContext';
import WattLogo from '@/components/WattLogo';

function EyeIcon({ className }: { className: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>;
}
function EyeOffIcon({ className }: { className: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>;
}

export default function ChangePasswordPage() {
  const router = useRouter();
  const { data: session, status, update } = useSession();
  const { t } = useLanguage();
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // If user already changed password, redirect to activity
  const mustChange = session?.user?.must_change_password;
  useEffect(() => {
    if (status === 'authenticated' && !mustChange) {
      router.replace('/activity');
    }
  }, [status, mustChange, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) {
      setError(t('auth.errorMinLength'));
      return;
    }
    if (newPassword !== confirm) {
      setError(t('auth.errorMismatch'));
      return;
    }
    setLoading(true);
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword }),
    });
    setLoading(false);
    if (res.ok) {
      setSuccess(true);
      // Update session to clear must_change_password, then redirect by role
      await update({ must_change_password: false });
      const role = session?.user?.role;
      const dest = role === 'admin' ? '/admin' : role === 'ceo' ? '/dashboard' : '/activity';
      setTimeout(() => { router.replace(dest); }, 2000);
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || t('auth.errorGeneric'));
    }
  }

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">{t('common.loading')}</div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'linear-gradient(135deg, var(--dark), var(--dark-alt))' }}>
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-3xl shadow-2xl p-8">
        <div className="flex justify-center mb-6">
          <div className="rounded-2xl px-4 py-3" style={{ backgroundColor: 'var(--dark)' }}>
            <WattLogo className="h-12 w-auto" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1 text-center">{t('auth.changePasswordTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 text-center">
          {t('auth.changePasswordDesc')}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">{t('auth.newPassword')}</label>
            <div className="relative">
              <input type={showNew ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} autoComplete="new-password"
                className="w-full px-4 py-3 pr-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />
              <button type="button" onClick={() => setShowNew(!showNew)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                {showNew ? <EyeOffIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">{t('auth.confirmPassword')}</label>
            <div className="relative">
              <input type={showConfirm ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6} autoComplete="new-password"
                className="w-full px-4 py-3 pr-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />
              <button type="button" onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                {showConfirm ? <EyeOffIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
              </button>
            </div>
          </div>
          {success && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 rounded-xl px-4 py-3 text-sm font-medium text-center">
              ✓ {t('auth.resetSuccess')}
            </div>
          )}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-xl px-4 py-2.5 text-sm">{error}</div>
          )}
          <button type="submit" disabled={loading || success}
            className="w-full py-3.5 rounded-xl text-white font-bold transition-colors disabled:opacity-60"
            style={{ backgroundColor: 'var(--primary)' }}>
            {loading ? '...' : t('auth.changePasswordBtn')}
          </button>
          <button type="button" onClick={() => signOut({ callbackUrl: '/login' })}
            className="w-full text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            {t('nav.logout')}
          </button>
        </form>
      </div>
    </div>
  );
}
