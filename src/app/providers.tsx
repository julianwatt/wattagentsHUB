'use client';
import { SessionProvider } from 'next-auth/react';
import { ThemeProvider } from '@/components/ThemeContext';
import { LanguageProvider } from '@/components/LanguageContext';
import { ColorThemeProvider } from '@/components/ColorThemeContext';
import { PreviewRoleProvider } from '@/components/PreviewRoleContext';

interface Props {
  children: React.ReactNode;
  themeId: string;
}

export function Providers({ children, themeId }: Props) {
  return (
    <SessionProvider>
      <ThemeProvider>
        <LanguageProvider>
          <ColorThemeProvider initialThemeId={themeId}>
            <PreviewRoleProvider>
              {children}
            </PreviewRoleProvider>
          </ColorThemeProvider>
        </LanguageProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
