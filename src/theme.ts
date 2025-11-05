import { useColorScheme } from 'react-native';

// Palette lifted from the M0 prototype's CSS variables (databases-drill.html).
export interface Palette {
  bg: string;
  card: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  /** accent at low alpha — selected option background */
  accentSoft: string;
  ok: string;
  okBg: string;
  bad: string;
  badBg: string;
  chip: string;
  tealBg: string;
  tealInk: string;
  amberBg: string;
  amberInk: string;
  codeBg: string;
  codeBorder: string;
  codeInk: string;
  codeLabel: string;
}

export const light: Palette = {
  bg: '#faf9f7',
  card: '#ffffff',
  ink: '#1c1b19',
  muted: '#6b6a66',
  line: '#e6e4de',
  accent: '#534ab7',
  accentSoft: 'rgba(83,74,183,0.08)',
  ok: '#1d9e75',
  okBg: '#e1f5ee',
  bad: '#e24b4a',
  badBg: '#fcebeb',
  chip: '#f1efe8',
  tealBg: '#e1f5ee',
  tealInk: '#0f6e56',
  amberBg: '#faeeda',
  amberInk: '#854f0b',
  codeBg: '#0e1116',
  codeBorder: '#243049',
  codeInk: '#d7e0ee',
  codeLabel: '#8aa0c6',
};

export const dark: Palette = {
  bg: '#1a1917',
  card: '#232220',
  ink: '#f2f0ea',
  muted: '#a3a19a',
  line: '#38362f',
  accent: '#afa9ec',
  accentSoft: 'rgba(175,169,236,0.12)',
  ok: '#5dcaa5',
  okBg: '#0f3d31',
  bad: '#f09595',
  badBg: '#3d1a1a',
  chip: '#2c2b28',
  tealBg: '#0f3d31',
  tealInk: '#9fe1cb',
  amberBg: '#3a2c12',
  amberInk: '#f5c88a',
  codeBg: '#0e1116',
  codeBorder: '#243049',
  codeInk: '#d7e0ee',
  codeLabel: '#8aa0c6',
};

export function useTheme(): { colors: Palette; isDark: boolean } {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  return { colors: isDark ? dark : light, isDark };
}

export const MONO = 'Menlo';
