'use client';

// Waitlist-scoped theme context. Unlike the global ThemeContext (which
// rewrites document.documentElement and affects every route), this provider
// only controls the look of pages mounted under /waitlist/*. Light vs dark
// is persisted to localStorage under `waitlist_theme` and surfaced via
// `useWaitlistTheme()` so components can pick the right token strings.
//
// Pages outside /waitlist/* keep whatever the global ThemeContext renders —
// they're never re-rendered by this provider.

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

type WaitlistThemeMode = 'light' | 'dark';
const STORAGE_KEY = 'waitlist_theme';

interface WaitlistThemeContextValue {
  mode: WaitlistThemeMode;
  isDark: boolean;
  toggle: () => void;
  setMode: (mode: WaitlistThemeMode) => void;
}

const Ctx = createContext<WaitlistThemeContextValue | null>(null);

export function WaitlistThemeProvider({ children }: { children: React.ReactNode }) {
  // SSR-safe: start with `light` (matches the cream-on-white spec). The
  // effect below restores the user's saved preference on the client without
  // causing a hydration mismatch (initial render is identical on both
  // server and client).
  const [mode, setModeState] = useState<WaitlistThemeMode>('light');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') setModeState(saved);
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
  }, []);

  const setMode = useCallback((next: WaitlistThemeMode) => {
    setModeState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  const toggle = useCallback(() => {
    setModeState((m) => {
      const next: WaitlistThemeMode = m === 'light' ? 'dark' : 'light';
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const isDark = mode === 'dark';

  return (
    <Ctx.Provider value={{ mode, isDark, toggle, setMode }}>
      {/* The wrapper div carries the data attribute so future CSS hooks
          can target waitlist-scoped overrides if needed. */}
      <div data-waitlist-theme={mode} className={isDark ? 'bg-black' : 'bg-[#FAF8F5]'}>
        {children}
      </div>
    </Ctx.Provider>
  );
}

export function useWaitlistTheme(): WaitlistThemeContextValue {
  const v = useContext(Ctx);
  if (!v) {
    // Outside /waitlist/* this provider isn't mounted — return a sensible
    // default so isolated component tests don't crash. The hook is never
    // expected to fire from non-waitlist routes in production.
    return {
      mode: 'light',
      isDark: false,
      toggle: () => {},
      setMode: () => {},
    };
  }
  return v;
}

// Shared token bundle so every waitlist surface (dashboard, auth shell,
// modals) picks identical class strings for the same logical role.
export function useWaitlistTokens() {
  const { isDark, toggle, setMode, mode } = useWaitlistTheme();
  const d = isDark;
  return {
    d, mode, toggle, setMode,
    bg:         d ? 'bg-black'           : 'bg-[#FAF8F5]',
    surface:    d ? 'bg-[#0f0f0f]'       : 'bg-white',
    border:     d ? 'border-white/[0.06]': 'border-black/[0.06]',
    txt:        d ? 'text-white'         : 'text-black',
    muted:      d ? 'text-white/60'      : 'text-black/60',
    sub:        d ? 'text-white/40'      : 'text-black/40',
    hov:        d ? 'hover:bg-white/5'   : 'hover:bg-black/[0.03]',
    inputBg:    d ? 'bg-white/5'         : 'bg-[#F5F3F0]',
    divider:    d ? 'border-white/[0.06]': 'border-black/[0.06]',
    accentBg:   d ? 'bg-white'           : 'bg-black',
    accentText: d ? 'text-black'         : 'text-white',
    cardShadow: d ? '' : 'shadow-[0_24px_60px_-30px_rgba(0,0,0,0.10),0_8px_24px_-16px_rgba(0,0,0,0.06)]',
  };
}
