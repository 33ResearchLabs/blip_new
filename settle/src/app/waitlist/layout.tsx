'use client';

// Waitlist-scoped layout — wraps every /waitlist/* page with the
// WaitlistThemeProvider so the light/dark toggle in the dashboard navbar
// only affects waitlist surfaces. Pages outside /waitlist/* keep
// rendering with whatever the global ThemeContext applies.

import { WaitlistThemeProvider } from '@/context/WaitlistThemeContext';

export default function WaitlistLayout({ children }: { children: React.ReactNode }) {
  return <WaitlistThemeProvider>{children}</WaitlistThemeProvider>;
}
