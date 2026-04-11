'use client';
import { useState, FormEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import WattLogo from '@/components/WattLogo';

export default function ChangePasswordPage() {
  const router = useRouter();
  const { data: session, status, update } = useSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // If user already changed password, redirect to activity
  useEffect(() => {
    if (status === 'authenticated' && !session?.user?.must_change_password) {
      router.replace('/activity');
    }
  }, [status, session, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) {
      setError('La nueva contraseña debe tener al menos 6 caracteres');
      return;
    }
    if (newPassword !== confirm) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setLoading(true);
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    setLoading(false);
    if (res.ok) {
      // Mark the JWT as no longer needing a change so middleware lets us through
      await update({ must_change_password: false });
      router.replace('/activity');
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || 'Error al cambiar la contraseña');
    }
  }

  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">Cargando...</div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'linear-gradient(135deg, var(--dark), var(--dark-alt))' }}>
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-3xl shadow-2xl p-8">
        <div className="flex justify-center mb-6">
          <div className="rounded-2xl px-4 py-3" style={{ backgroundColor: 'var(--dark)' }}>
            <WattLogo className="h-12 w-auto" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1 text-center">Cambia tu contraseña</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 text-center">
          Por seguridad, debes establecer una nueva contraseña antes de continuar.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">Contraseña temporal</label>
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required autoComplete="current-password"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">Nueva contraseña</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} autoComplete="new-password"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 uppercase tracking-wide">Confirmar nueva contraseña</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6} autoComplete="new-password"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />
          </div>
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-xl px-4 py-2.5 text-sm">{error}</div>
          )}
          <button type="submit" disabled={loading}
            className="w-full py-3.5 rounded-xl text-white font-bold transition-colors disabled:opacity-60"
            style={{ backgroundColor: 'var(--primary)' }}>
            {loading ? 'Guardando...' : 'Cambiar contraseña'}
          </button>
          <button type="button" onClick={() => signOut({ callbackUrl: '/login' })}
            className="w-full text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  );
}
