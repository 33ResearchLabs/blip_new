'use client';

// /waitlist/login — user sign-in entry point. The shell holds role/mode
// in state and renders the matching form internally, so toggling between
// User↔Merchant or Sign in↔Sign up no longer triggers a route change.

import { Suspense } from 'react';
import WaitlistAuthShell from '@/components/waitlist/WaitlistAuthShell';

export default function WaitlistUserLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FAF8F5] dark:bg-black" />}>
      <WaitlistAuthShell initialRole="user" initialMode="signin" />
    </Suspense>
  );
}
