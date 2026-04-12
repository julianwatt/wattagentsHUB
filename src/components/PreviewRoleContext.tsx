'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useSession } from 'next-auth/react';

export type Role = 'agent' | 'jr_manager' | 'sr_manager' | 'admin' | 'ceo';

interface Ctx {
  realRole: Role | null;
  previewRole: Role | null;
  previewUserId: string | null;
  previewUserName: string | null;
  effectiveRole: Role | null;
  setPreviewRole: (r: Role | null) => void;
  setPreviewUser: (userId: string | null, role: Role | null, name: string | null) => void;
}

const PreviewRoleContext = createContext<Ctx>({
  realRole: null,
  previewRole: null,
  previewUserId: null,
  previewUserName: null,
  effectiveRole: null,
  setPreviewRole: () => {},
  setPreviewUser: () => {},
});

const STORAGE_KEY = 'wattPreviewRole';
const STORAGE_USER_KEY = 'wattPreviewUser';
const VALID_PREVIEW: Role[] = ['agent', 'jr_manager', 'sr_manager', 'ceo'];

export function PreviewRoleProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const realRole = (session?.user?.role as Role | undefined) ?? null;
  const [previewRole, setPreviewRoleState] = useState<Role | null>(null);
  const [previewUserId, setPreviewUserId] = useState<string | null>(null);
  const [previewUserName, setPreviewUserName] = useState<string | null>(null);

  // Restore preview from localStorage when the actual viewer is admin
  useEffect(() => {
    if (realRole !== 'admin') {
      setPreviewRoleState(null);
      setPreviewUserId(null);
      setPreviewUserName(null);
      return;
    }
    try {
      const savedUser = localStorage.getItem(STORAGE_USER_KEY);
      if (savedUser) {
        const parsed = JSON.parse(savedUser);
        if (parsed.id && parsed.role && (VALID_PREVIEW as string[]).includes(parsed.role)) {
          setPreviewUserId(parsed.id);
          setPreviewRoleState(parsed.role as Role);
          setPreviewUserName(parsed.name ?? null);
          return;
        }
      }
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && (VALID_PREVIEW as string[]).includes(saved)) {
        setPreviewRoleState(saved as Role);
      }
    } catch {}
  }, [realRole]);

  const setPreviewRole = (r: Role | null) => {
    if (realRole !== 'admin') return;
    setPreviewRoleState(r);
    setPreviewUserId(null);
    setPreviewUserName(null);
    try {
      localStorage.removeItem(STORAGE_USER_KEY);
      if (r) localStorage.setItem(STORAGE_KEY, r);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  const setPreviewUser = (userId: string | null, role: Role | null, name: string | null) => {
    if (realRole !== 'admin') return;
    setPreviewUserId(userId);
    setPreviewRoleState(role);
    setPreviewUserName(name);
    try {
      if (userId && role) {
        localStorage.setItem(STORAGE_USER_KEY, JSON.stringify({ id: userId, role, name }));
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.removeItem(STORAGE_USER_KEY);
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {}
  };

  const effectiveRole: Role | null =
    realRole === 'admin' && previewRole ? previewRole : realRole;

  return (
    <PreviewRoleContext.Provider value={{ realRole, previewRole, previewUserId, previewUserName, effectiveRole, setPreviewRole, setPreviewUser }}>
      {children}
    </PreviewRoleContext.Provider>
  );
}

export function usePreviewRole(): Ctx {
  return useContext(PreviewRoleContext);
}
