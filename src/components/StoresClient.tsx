'use client';
import { useEffect, useState, useCallback } from 'react';
import { useLanguage } from './LanguageContext';
import StoreFormModal from './StoreFormModal';
import ToggleSwitch from './ToggleSwitch';

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
    // Optimistic flip
    setStores((prev) => prev.map((x) => x.id === s.id ? { ...x, is_active: !s.is_active } : x));
    try {
      const res = await fetch('/api/stores', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id, is_active: !s.is_active }),
      });
      if (!res.ok) {
        // Revert on failure
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
          {stores.map((s) => (
            <li
              key={s.id}
              className={`rounded-2xl border bg-white dark:bg-gray-900 shadow-sm p-4 flex flex-col gap-2 transition-opacity ${
                s.is_active
                  ? 'border-gray-100 dark:border-gray-800'
                  : 'border-gray-200 dark:border-gray-700 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{s.name}</p>
                  {s.address && (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 leading-snug break-words">
                      {s.address}
                    </p>
                  )}
                </div>
                <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${
                  s.is_active
                    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                }`}>
                  {s.is_active ? t('stores.active') : t('stores.inactive')}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-gray-500 dark:text-gray-400 tabular-nums font-mono">
                <span>📍 {s.latitude.toFixed(5)}, {s.longitude.toFixed(5)}</span>
                {s.geofence_radius_meters != null && (
                  <span>· {s.geofence_radius_meters}m</span>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 mt-1">
                <button
                  onClick={() => setEditingStore(s)}
                  className="text-[11px] font-bold px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors"
                >
                  ✎ {t('stores.editBtn')}
                </button>
                <ToggleSwitch
                  checked={s.is_active}
                  onChange={() => toggle(s)}
                  disabled={toggling === s.id}
                  size="lg"
                  ariaLabel={s.is_active ? t('stores.deactivate') : t('stores.activate')}
                />
              </div>
            </li>
          ))}
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
    </div>
  );
}
