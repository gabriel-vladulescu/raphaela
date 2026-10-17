import { useSyncExternalStore } from 'react';

export const THEMES = ['light', 'dark', 'midnight'] as const;
export type Theme = (typeof THEMES)[number];

const listeners = new Set<() => void>();

/** The theme on <html> (index.html applies the saved one before React starts; midnight by default). */
export function currentTheme(): Theme {
  const theme = document.documentElement.dataset.theme;
  return THEMES.includes(theme as Theme) ? (theme as Theme) : 'midnight';
}

/** Each theme's page background, for the phone's status bar (index.html sets it before the app loads). */
const THEME_COLORS: Record<Theme, string> = { light: '#f5f3fb', dark: '#111017', midnight: '#050918' };

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
  try {
    localStorage.setItem('theme', theme);
  } catch {
    // Not persisted (e.g. private mode); the theme still applies for this visit.
  }
  listeners.forEach((listener) => listener());
}

export function useTheme(): Theme {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, currentTheme);
}
