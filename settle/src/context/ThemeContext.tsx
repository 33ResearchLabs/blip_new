'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type Theme = 'dark' | 'light' | 'clean' | 'navy' | 'emerald' | 'orchid' | 'gold';

export const THEMES: { id: Theme; label: string; color: string }[] = [
  { id: 'dark', label: 'Amoled Dark', color: '#F97316' },
  { id: 'navy', label: 'Midnight Navy', color: '#38BDF8' },
  { id: 'emerald', label: 'Emerald Matrix', color: '#10B981' },
  { id: 'orchid', label: 'Cyberpunk Orchid', color: '#E94560' },
  { id: 'gold', label: 'Slate & Gold', color: '#D4AF37' },
  { id: 'clean', label: 'Clean White', color: '#3B82F6' },
  { id: 'light', label: 'Solarized Light', color: '#268BD2' },
];

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  isLoaded: boolean;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

const LIGHT_THEMES: Theme[] = ['light', 'clean'];

function applyTheme(theme: Theme) {
  const el = document.documentElement;
  el.removeAttribute('data-theme');
  el.classList.remove('light');

  if (theme === 'dark') {
    // Default — no attribute needed, :root styles apply
  } else {
    el.setAttribute('data-theme', theme);
    if (LIGHT_THEMES.includes(theme)) {
      el.classList.add('light');
    }
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add('no-transitions');

    const savedTheme = localStorage.getItem('theme') as Theme | null;
    if (savedTheme && THEMES.some(t => t.id === savedTheme)) {
      setThemeState(savedTheme);
      applyTheme(savedTheme);
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.classList.remove('no-transitions');
        setIsLoaded(true);
      });
    });
  }, []);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);
    applyTheme(newTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    const idx = THEMES.findIndex(t => t.id === theme);
    const next = THEMES[(idx + 1) % THEMES.length].id;
    setTheme(next);
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme, isLoaded }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
