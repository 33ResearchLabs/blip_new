'use client';

// Waitlist-scoped layout — wraps every /waitlist/* page with the
// WaitlistThemeProvider so the light/dark toggle in the dashboard navbar
// only affects waitlist surfaces. Pages outside /waitlist/* keep
// rendering with whatever the global ThemeContext applies.
//
// Also mounts the shared WaitlistFooter at the bottom of every page so
// the brand line ("© BLIP.MONEY · FAST. SIMPLE. BLIP.") is consistent
// across auth and dashboard surfaces without each page importing it.

import { WaitlistThemeProvider } from '@/context/WaitlistThemeContext';
import WaitlistFooter from '@/components/waitlist/WaitlistFooter';

export default function WaitlistLayout({ children }: { children: React.ReactNode }) {
  return (
    <WaitlistThemeProvider>
      <div className="flex min-h-screen flex-col">
        <div className="flex-1">{children}</div>
        <WaitlistFooter />
      </div>
    </WaitlistThemeProvider>
  );
}
