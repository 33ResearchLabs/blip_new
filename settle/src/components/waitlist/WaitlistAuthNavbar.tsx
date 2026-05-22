'use client';

// Slim navbar for the unauthenticated waitlist pages (login + register).
// Logo-only — the user/merchant toggle and "Sign up / Sign in" cross-links
// were removed by request. Light/dark aware so it sits cleanly on the
// AuthPageLayout background.

import { Logo } from '@/components/shared/Logo';

interface Props {
  // Retained on the signature so existing callers don't need to change. Not
  // currently rendered — left here in case we want to surface a context-
  // specific action again in the future.
  current: 'user-login' | 'merchant-login' | 'user-register' | 'merchant-register';
}

export default function WaitlistAuthNavbar(_props: Props) {
  void _props;
  return (
    <header className="sticky top-0 z-50 bg-[#FAF8F5]/80 dark:bg-black/80 backdrop-blur-md border-b border-black/[0.06] dark:border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex items-center">
        <Logo href="/waitlist" />
      </div>
    </header>
  );
}
