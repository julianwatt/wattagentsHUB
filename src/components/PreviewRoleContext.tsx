'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useSession } from 'next-auth/react';

export type Role = 'agent' | 'jr_manager' | 'sr_manager' | 'admin' | 'ceo';

interface Ctx {
  realRole: Role | null;
  previewRole: Role | null;
  effectiveRole: Role | null;
  setPreviewRole: (r: Role | null) => void;
}

const PreviewRoleContext = createContext<Ctx>({
  realRole: null,
  previewRole: null,
  effectiveRole: null,
  setPreviewRole: () => {},
});

const STORAGE_KEY = 'wattPreviewRole';
const VALID_PREVIEW: Role[] = ['agent', 'jr_manager', 'sr_manager', 'ceo'];

export function PreviewRoleProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const realRole = (session?.user?.role as Role | undefined) ?? null;
  const [previewRole, setPreviewRoleState] = useState<Role | null>(null);

  // Restore preview from localStorage when the actual viewer is admin
  useEffect(() => {
    if (realRole !== 'admin') {
      setPreviewRoleState(null);
      return;
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && (VALID_PREVIEW as string[]).includes(saved)) {
        setPreviewRoleState(saved as Role);
      }
    } catch {}
  }, [realRole]);

  const setPreviewRole = (r: Role | null) => {
    if (realRole !== 'admin') return;
    setPreviewRoleState(r);
    try {
      if (r) localStorage.setItem(STORAGE_KEY, r);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  const effectiveRole: Role | null =
    realRole === 'admin' && previewRole ? previewRole : realRole;

  return (
    <PreviewRoleContext.Provider value={{ realRole, previewRole, effectiveRole, setPreviewRole }}>
      {children}
    </PreviewRoleContext.Provider>
  );
}

export function usePreviewRole(): Ctx {
  return useContext(PreviewRoleContext);
}
