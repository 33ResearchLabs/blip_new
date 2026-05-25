'use client';

// Black navbar pinned to the top of every waitlist auth surface. Stays
// black-on-white-logo in both light and dark waitlist themes — the brand
// surface is intentionally fixed so the page below can flip its theme
// without breaking the brand area.

import Link from 'next/link';
import { motion } from 'framer-motion';
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
  // Dimensions and positioning match futureStick Navbar.tsx exactly:
  //   - max-w-[1280px] inner container
  //   - px-5 sm:px-8 lg:px-10 horizontal padding (scales by breakpoint)
  //   - h-[58px] navbar height
  //   - fixed w-full positioning so the navbar overlays the top of the
  //     page, instead of taking 58px in the document flow. With sticky
  //     the navbar pushed content 58px down, producing the
  //     "too much empty space above EARLY ACCESS" gap the user flagged.
  //     With fixed, the shell's pt-16 md:pt-24 lands the content at
  //     96px from viewport top — exactly where production renders it.
  return (
    <header
      className="fixed inset-x-0 top-0 z-50"
      style={{
        background: '#000000',
        color: '#ffffff',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div className="max-w-[1280px] mx-auto px-5 sm:px-8 lg:px-10 h-[58px] flex items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <Logo href="/waitlist" onDark />
          {/* MAINNET · LIVE indicator — mirrors futureStick Navbar.tsx:139-152:
              monospace, text-[9.5px], tracking-[0.22em], white/55, with a
              left divider and a pulsing accent dot (opacity loop, plus a
              soft 8px brand-orange glow). */}
          <div className="hidden md:flex items-center gap-1.5 pl-4 ml-1 border-l border-white/[0.08]">
            <motion.span
              animate={{ opacity: [1, 0.35, 1] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: '#cc785c',
                boxShadow: '0 0 8px rgba(204,120,92,0.7)',
              }}
            />
            <span
              className="text-[9.5px] font-semibold tracking-[0.22em]"
              style={{
                // Explicit rgba bypasses the globals.css
                // [class*="text-white"] substring rewrite that would
                // otherwise repaint this label dark on the black navbar.
                color: 'rgba(255,255,255,0.55)',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              }}
            >
              MAINNET · LIVE
            </span>
          </div>
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
