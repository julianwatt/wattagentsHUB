'use client';
import { useEffect, useState, useCallback } from 'react';
import { useLanguage } from './LanguageContext';
import StoreFormModal from './StoreFormModal';
import StoreLogo from './StoreLogo';
import ToggleSwitch from './ToggleSwitch';
import { parseStoreAddress } from '@/lib/stores';

interface Store {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  geofence_radius_meters: number | null;
  is_active: boolean;
  created_at: string;
}

export default function StoresClient() {
  const { t } = useLanguage();

  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<Store | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchStores = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/stores', { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        setStores(j.stores ?? []);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStores(); }, [fetchStores]);

  const toggle = async (s: Store) => {
    setToggling(s.id);
    setStores((prev) => prev.map((x) => x.id === s.id ? { ...x, is_active: !s.is_active } : x));
    try {
      const res = await fetch('/api/stores', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id, is_active: !s.is_active }),
      });
      if (!res.ok) {
        setStores((prev) => prev.map((x) => x.id === s.id ? { ...x, is_active: s.is_active } : x));
      }
    } catch {
      setStores((prev) => prev.map((x) => x.id === s.id ? { ...x, is_active: s.is_active } : x));
    }
    setToggling(null);
  };

  const handleSaved = () => {
    setShowAdd(false);
    setEditingStore(null);
    fetchStores();
  };

  const handleConfirmDelete = async () => {
    if (!confirmingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch('/api/stores', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: confirmingDelete.id }),
      });
      if (!res.ok) {
        setDeleteError(t('stores.errorDelete'));
        setDeleting(false);
        return;
      }
      setStores((prev) => prev.filter((x) => x.id !== confirmingDelete.id));
      setConfirmingDelete(null);
    } catch {
      setDeleteError(t('stores.errorDelete'));
    }
    setDeleting(false);
  };

  return (
    <div className="space-y-4">
      {/* Header / add button */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {stores.length} {t('stores.totalLabel')}
        </p>
        <button
          onClick={() => setShowAdd(true)}
          className="text-[11px] sm:text-xs font-bold px-3 py-2 rounded-xl text-white transition-colors"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          + {t('stores.addBtn')}
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
          <p className="text-xs text-gray-400">{t('common.loading')}</p>
        </div>
      ) : stores.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm py-12 text-center">
          <p className="text-3xl mb-2">🏪</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('stores.empty')}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {stores.map((s) => {
            const { street, city, zip } = parseStoreAddress(s.address);
            const addressLine = [street, city, zip].filter(Boolean).join(', ');
            return (
              <li
                key={s.id}
                className={`rounded-2xl border bg-white dark:bg-gray-900 shadow-sm p-4 flex flex-col gap-3 transition-opacity ${
                  s.is_active
                    ? 'border-gray-100 dark:border-gray-800'
                    : 'border-gray-200 dark:border-gray-700 opacity-60'
                }`}
              >
                {/* Header — logo + type title + status badge */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 flex items-center gap-2.5">
                    <StoreLogo type={s.name} size={28} />
                    <p className="text-base font-bold text-gray-900 dark:text-gray-100 truncate">
                      {s.name}
                    </p>
                  </div>
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${
                    s.is_active
                      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                  }`}>
                    {s.is_active ? t('stores.active') : t('stores.inactive')}
                  </span>
                </div>

                {/* Body — address (primary) + coordinates (secondary) */}
                <div className="space-y-1">
                  {addressLine && (
                    <p className="text-[13px] text-gray-700 dark:text-gray-200 leading-snug break-words">
                      📍 {addressLine}
                    </p>
                  )}
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums font-mono">
                    {s.latitude.toFixed(5)}, {s.longitude.toFixed(5)}
                    {s.geofence_radius_meters != null && (
                      <span className="ml-2">· {s.geofence_radius_meters}m</span>
                    )}
                  </p>
                </div>

                {/* Actions — edit | delete | toggle */}
                <div className="flex items-center justify-between gap-2 mt-1">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setEditingStore(s)}
                      className="text-[11px] font-bold px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors"
                    >
                      ✎ {t('stores.editBtn')}
                    </button>
                    <button
                      onClick={() => { setDeleteError(null); setConfirmingDelete(s); }}
                      className="text-[11px] font-bold px-2.5 py-1 rounded-lg border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      🗑 {t('stores.deleteBtn')}
                    </button>
                  </div>
                  <ToggleSwitch
                    checked={s.is_active}
                    onChange={() => toggle(s)}
                    disabled={toggling === s.id}
                    size="lg"
                    ariaLabel={s.is_active ? t('stores.deactivate') : t('stores.activate')}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {showAdd && (
        <StoreFormModal
          onClose={() => setShowAdd(false)}
          onSaved={handleSaved}
        />
      )}

      {editingStore && (
        <StoreFormModal
          onClose={() => setEditingStore(null)}
          onSaved={handleSaved}
          initialStore={{
            id: editingStore.id,
            name: editingStore.name,
            address: editingStore.address,
            latitude: editingStore.latitude,
            longitude: editingStore.longitude,
            geofence_radius_meters: editingStore.geofence_radius_meters,
          }}
        />
      )}

      {/* Delete confirmation dialog — same patterns as the rest of the
          platform (centered modal, dark backdrop, two-button footer). */}
      {confirmingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-sm flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
                {t('stores.deleteConfirmTitle')}
              </h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-700 dark:text-gray-200 leading-snug">
                {t('stores.deleteConfirmBody').replace('{name}', confirmingDelete.name)}
              </p>
              {deleteError && (
                <p className="mt-3 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2.5">
                  {deleteError}
                </p>
              )}
            </div>
            <div className="flex gap-2 px-5 py-3 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => { setConfirmingDelete(null); setDeleteError(null); }}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-60"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-60"
              >
                {deleting ? t('stores.deleting') : t('stores.deleteConfirmYes')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
