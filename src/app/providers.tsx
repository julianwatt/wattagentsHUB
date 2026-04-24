'use client';
import { SessionProvider } from 'next-auth/react';
import { ThemeProvider } from '@/components/ThemeContext';
import { LanguageProvider } from '@/components/LanguageContext';
import { ColorThemeProvider } from '@/components/ColorThemeContext';
import { PreviewRoleProvider } from '@/components/PreviewRoleContext';
import { ShiftProvider } from '@/components/ShiftContext';

interface Props {
  children: React.ReactNode;
  themeId: string;
}

export function Providers({ children, themeId }: Props) {
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
