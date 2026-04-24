'use client';
import { SessionProvider } from 'next-auth/react';
import { useEffect } from 'react';
import { ThemeProvider } from '@/components/ThemeContext';
import { LanguageProvider } from '@/components/LanguageContext';
import { ColorThemeProvider } from '@/components/ColorThemeContext';
import { PreviewRoleProvider } from '@/components/PreviewRoleContext';
import { ShiftProvider } from '@/components/ShiftContext';

function useServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js');
    }
  }, []);
}

interface Props {
  children: React.ReactNode;
  themeId: string;
}

export function Providers({ children, themeId }: Props) {
  useServiceWorker();
  return (
    <SessionProvider refetchOnWindowFocus={false} refetchInterval={0}>
      <ThemeProvider>
        <LanguageProvider>
          <ColorThemeProvider initialThemeId={themeId}>
            <PreviewRoleProvider>
              <ShiftProvider>
                {children}
              </ShiftProvider>
            </PreviewRoleProvider>
          </ColorThemeProvider>
        </LanguageProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
