'use client';
import { createContext, useContext, useState, ReactNode } from 'react';
import { ColorTheme, getThemeById, themeToCSS } from '@/lib/themes';

interface Ctx {
  themeId: string;
  theme: ColorTheme;
  setTheme: (id: string) => Promise<void>;
}

const ColorThemeCtx = createContext<Ctx>({
  themeId: 'watt-gold',
  theme: getThemeById('watt-gold'),
  setTheme: async () => {},
});

export function ColorThemeProvider({ children, initialThemeId }: { children: ReactNode; initialThemeId: string }) {
  const [themeId, setThemeId] = useState(initialThemeId);
  const [theme, setThemeState] = useState(getThemeById(initialThemeId));

  const setTheme = async (id: string) => {
    const newTheme = getThemeById(id);
    setThemeId(id);
    setThemeState(newTheme);
    // Apply CSS variables immediately (client-side preview)
    const root = document.documentElement;
    const vars = themeToCSS(newTheme);
    vars.split(';').forEach((pair) => {
      const [k, v] = pair.split(':');
      if (k && v) root.style.setProperty(k.trim(), v.trim());
    });
    // Persist via API (sets cookie + KV)
    await fetch('/api/theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeId: id }),
    });
  };

  return (
    <ColorThemeCtx.Provider value={{ themeId, theme, setTheme }}>
      {children}
    </ColorThemeCtx.Provider>
  );
}

export const useColorTheme = () => useContext(ColorThemeCtx);
