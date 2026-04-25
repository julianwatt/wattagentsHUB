'use client';
import { useLanguage } from './LanguageContext';

export interface PreviewUser { id: string; name: string; role: string; }

interface Props {
  mode: 'desktop' | 'mobile';
  previewRole: string | null;
  previewUserId: string | null;
  previewUsers: PreviewUser[];
  realRole?: string;
  onChange: (value: string) => void;
  onExit?: () => void;
}

export default function PreviewRoleSwitcher({
  mode,
  previewRole,
  previewUserId,
  previewUsers,
  realRole,
  onChange,
  onExit,
}: Props) {
  const { t, lang } = useLanguage();
  const value = previewUserId ? `user:${previewUserId}` : (previewRole ?? '');
  const rolesGroupLabel = lang === 'es' ? '— Roles —' : '— Roles —';
  const usersGroupLabel = lang === 'es' ? '— Usuarios —' : '— Users —';

  const roles: { value: string; label: string }[] = [
    { value: 'agent', label: t('admin.roleAgent') },
    { value: 'jr_manager', label: t('admin.roleJrManager') },
    { value: 'sr_manager', label: t('admin.roleSrManager') },
    { value: 'ceo', label: t('admin.roleCeo') },
  ].filter((r) => r.value !== realRole);

  if (mode === 'desktop') {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={t('admin.viewAs')}
        className="hidden lg:block h-8 px-2 rounded-lg text-[11px] font-bold bg-white/10 text-white hover:bg-white/20 border border-white/20 focus:outline-none focus:ring-2 focus:ring-white/40 max-w-[180px]"
      >
        <option value="" className="text-gray-900">
          👁️ {t('admin.viewAs')}
        </option>
        <optgroup label={rolesGroupLabel} className="text-gray-900">
          {roles.map((r) => (
            <option key={r.value} value={r.value} className="text-gray-900">{r.label}</option>
          ))}
        </optgroup>
        {previewUsers.length > 0 && (
          <optgroup label={usersGroupLabel} className="text-gray-900">
            {previewUsers.map((u) => (
              <option key={u.id} value={`user:${u.id}`} className="text-gray-900">
                {u.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    );
  }

  return (
    <div className="mx-4 mb-3 space-y-2">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 px-2 rounded-xl text-[11px] font-bold bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
      >
        <option value="">👁️ {t('admin.viewAs')}</option>
        <optgroup label={rolesGroupLabel}>
          {roles.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </optgroup>
        {previewUsers.length > 0 && (
          <optgroup label={usersGroupLabel}>
            {previewUsers.map((u) => (
              <option key={u.id} value={`user:${u.id}`}>{u.name}</option>
            ))}
          </optgroup>
        )}
      </select>
      {previewRole && onExit && (
        <button
          onClick={onExit}
          className="w-full h-9 rounded-xl text-[11px] font-bold bg-amber-400 text-amber-950 hover:bg-amber-500 transition-colors"
        >
          {t('admin.exitPreview')}
        </button>
      )}
    </div>
  );
}
