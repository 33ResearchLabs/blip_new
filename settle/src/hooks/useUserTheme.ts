'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * useUserTheme — dark/light state for the user route ONLY.
 *
 * Independent of the merchant ThemeContext (which has 7 themes:
 * dark, navy, emerald, orchid, gold, light, clean). The user side only ever
 * has two themes — dark or light — and persists its choice under its own
 * localStorage key so toggling here never affects the merchant UI and
 * vice versa.
 */
export type UserTheme = 'dark' | 'light';

const STORAGE_KEY = 'user_theme';

export function useUserTheme() {
  // User app ships in the light (cream) look by default; dark stays available
  // via the toggle for anyone who saved that preference.
  const [theme, setThemeState] = useState<UserTheme>('light');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') setThemeState(saved);
    } catch {}
  }, []);

  const setTheme = useCallback((next: UserTheme) => {
    setThemeState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState(prev => {
      const next: UserTheme = prev === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(STORAGE_KEY, next); } catch {}
      return next;
    });
  }, []);

  return { theme, setTheme, toggleTheme };
}
