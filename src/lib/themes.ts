export interface ColorTheme {
  id: string;
  name: string;
  primary: string;
  primaryHover: string;
  primaryLight: string;
  primaryRing: string;
  dark: string;
  darkAlt: string;
  darkLight: string;
  font: string;
}

export const THEMES: ColorTheme[] = [
  {
    id: 'watt-gold',
    name: 'Watt Gold',
    primary: '#c2994b',
    primaryHover: '#a87a3a',
    primaryLight: 'rgba(194,153,75,0.12)',
    primaryRing: 'rgba(194,153,75,0.45)',
    dark: '#0b182b',
    darkAlt: '#0d2040',
    darkLight: 'rgba(11,24,43,0.10)',
    font: 'Inter',
  },
  {
    id: 'energy-orange',
    name: 'Energy Orange',
    primary: '#f47920',
    primaryHover: '#d96a18',
    primaryLight: 'rgba(244,121,32,0.12)',
    primaryRing: 'rgba(244,121,32,0.45)',
    dark: '#1b3a6b',
    darkAlt: '#0d2347',
    darkLight: 'rgba(27,58,107,0.10)',
    font: 'Inter',
  },
  {
    id: 'royal-blue',
    name: 'Royal Blue',
    primary: '#2563eb',
    primaryHover: '#1d4ed8',
    primaryLight: 'rgba(37,99,235,0.12)',
    primaryRing: 'rgba(37,99,235,0.45)',
    dark: '#0f172a',
    darkAlt: '#1e293b',
    darkLight: 'rgba(15,23,42,0.10)',
    font: 'Inter',
  },
  {
    id: 'forest',
    name: 'Forest Green',
    primary: '#16a34a',
    primaryHover: '#15803d',
    primaryLight: 'rgba(22,163,74,0.12)',
    primaryRing: 'rgba(22,163,74,0.45)',
    dark: '#052e16',
    darkAlt: '#14532d',
    darkLight: 'rgba(5,46,22,0.10)',
    font: 'Inter',
  },
  {
    id: 'crimson',
    name: 'Crimson Red',
    primary: '#dc2626',
    primaryHover: '#b91c1c',
    primaryLight: 'rgba(220,38,38,0.12)',
    primaryRing: 'rgba(220,38,38,0.45)',
    dark: '#450a0a',
    darkAlt: '#7f1d1d',
    darkLight: 'rgba(69,10,10,0.10)',
    font: 'Inter',
  },
  {
    id: 'amethyst',
    name: 'Amethyst',
    primary: '#7c3aed',
    primaryHover: '#6d28d9',
    primaryLight: 'rgba(124,58,237,0.12)',
    primaryRing: 'rgba(124,58,237,0.45)',
    dark: '#1e1b4b',
    darkAlt: '#2e1065',
    darkLight: 'rgba(30,27,75,0.10)',
    font: 'Inter',
  },
  {
    id: 'ocean',
    name: 'Ocean Teal',
    primary: '#0d9488',
    primaryHover: '#0f766e',
    primaryLight: 'rgba(13,148,136,0.12)',
    primaryRing: 'rgba(13,148,136,0.45)',
    dark: '#042f2e',
    darkAlt: '#134e4a',
    darkLight: 'rgba(4,47,46,0.10)',
    font: 'Inter',
  },
  {
    id: 'slate',
    name: 'Steel Slate',
    primary: '#475569',
    primaryHover: '#334155',
    primaryLight: 'rgba(71,85,105,0.12)',
    primaryRing: 'rgba(71,85,105,0.45)',
    dark: '#0f172a',
    darkAlt: '#1e293b',
    darkLight: 'rgba(15,23,42,0.10)',
    font: 'Inter',
  },
  {
    id: 'copper',
    name: 'Copper',
    primary: '#d97706',
    primaryHover: '#b45309',
    primaryLight: 'rgba(217,119,6,0.12)',
    primaryRing: 'rgba(217,119,6,0.45)',
    dark: '#1c0f00',
    darkAlt: '#78350f',
    darkLight: 'rgba(28,15,0,0.10)',
    font: 'Inter',
  },
  {
    id: 'rose',
    name: 'Rose',
    primary: '#e11d48',
    primaryHover: '#be123c',
    primaryLight: 'rgba(225,29,72,0.12)',
    primaryRing: 'rgba(225,29,72,0.45)',
    dark: '#1a0011',
    darkAlt: '#881337',
    darkLight: 'rgba(26,0,17,0.10)',
    font: 'Inter',
  },
  {
    id: 'cobalt',
    name: 'Cobalt',
    primary: '#0ea5e9',
    primaryHover: '#0284c7',
    primaryLight: 'rgba(14,165,233,0.12)',
    primaryRing: 'rgba(14,165,233,0.45)',
    dark: '#0a1628',
    darkAlt: '#0c4a6e',
    darkLight: 'rgba(10,22,40,0.10)',
    font: 'Inter',
  },
  {
    id: 'sage',
    name: 'Sage',
    primary: '#65a30d',
    primaryHover: '#4d7c0f',
    primaryLight: 'rgba(101,163,13,0.12)',
    primaryRing: 'rgba(101,163,13,0.45)',
    dark: '#1a2e05',
    darkAlt: '#365314',
    darkLight: 'rgba(26,46,5,0.10)',
    font: 'Inter',
  },
];

export const DEFAULT_THEME_ID = 'watt-gold';

export function getThemeById(id: string): ColorTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function themeToCSS(theme: ColorTheme): string {
  return `
    --primary: ${theme.primary};
    --primary-hover: ${theme.primaryHover};
    --primary-light: ${theme.primaryLight};
    --primary-ring: ${theme.primaryRing};
    --dark: ${theme.dark};
    --dark-alt: ${theme.darkAlt};
    --dark-light: ${theme.darkLight};
  `;
}
