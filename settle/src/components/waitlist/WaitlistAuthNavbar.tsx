'use client';

// Black navbar pinned to the top of every waitlist auth surface. Stays
// black-on-white-logo in both light and dark waitlist themes — the brand
// surface is intentionally fixed so the page below can flip its theme
// without breaking the brand area.

import Link from 'next/link';
import { ArrowRight, Sun, Moon } from 'lucide-react';
import { Logo } from '@/components/shared/Logo';
import { useWaitlistTheme } from '@/context/WaitlistThemeContext';

interface Props {
  // Retained for backward compatibility with existing call sites.
  current?: 'user-login' | 'merchant-login' | 'user-register' | 'merchant-register';
}

export default function WaitlistAuthNavbar(_props: Props) {
  void _props;
  const { isDark, toggle } = useWaitlistTheme();
  return (
    <header
      className="sticky top-0 z-50"
      style={{
        background: '#000000',
        color: '#ffffff',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <Logo href="/waitlist" onDark />
          <span
            className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.18em] uppercase"
            style={{ color: 'rgba(255,255,255,0.6)' }}
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full animate-ping" style={{ background: 'rgba(204,120,92,0.6)' }} />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: '#cc785c' }} />
            </span>
            Mainnet · Live
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
            className="w-9 h-9 rounded-full flex items-center justify-center transition hover:opacity-90"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            {isDark
              ? <Sun className="w-4 h-4" style={{ color: '#ffffff' }} />
              : <Moon className="w-4 h-4" style={{ color: '#ffffff' }} />}
          </button>

          <Link
            href="/waitlist/user"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12px] font-semibold hover:opacity-90 transition"
            style={{ background: '#ffffff', color: '#000000' }}
          >
            Join Waitlist
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}
