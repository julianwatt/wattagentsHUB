import type { Metadata } from 'next';
import { Inter, Playfair_Display } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';
import { Providers } from './providers';
import { getThemeById, themeToCSS, DEFAULT_THEME_ID } from '@/lib/themes';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
export const playfair = Playfair_Display({ subsets: ['latin'], weight: ['700', '800'], variable: '--font-playfair' });

export const metadata: Metadata = {
  title: 'Watt Distributors — Bill Simulator',
  description: 'Simulador de cargos de electricidad en Texas — Watt Distributors',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const themeId = cookieStore.get('app-theme')?.value ?? DEFAULT_THEME_ID;
  const theme = getThemeById(themeId);
  const cssVars = themeToCSS(theme);

  return (
    <html lang="es" className="h-full" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        {/* Inject theme CSS variables server-side (no flash) */}
        <style dangerouslySetInnerHTML={{ __html: `:root { ${cssVars} }` }} />
        {/* Prevent dark mode flash */}
        <script dangerouslySetInnerHTML={{
          __html: `(function(){var t=localStorage.getItem('theme');var p=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';if((t||p)==='dark')document.documentElement.classList.add('dark');})();`
        }} />
      </head>
      <body className={`${inter.variable} ${playfair.variable} ${inter.className} h-full bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 transition-colors`}>
        <Providers themeId={themeId}>{children}</Providers>
      </body>
    </html>
  );
}
