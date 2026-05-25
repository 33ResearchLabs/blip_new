'use client';

// /waitlist/user — user registration entry point. Suspense wraps the
// shell because the inner RegisterForm reads useSearchParams (?ref=…)
// for the referral code, which otherwise opts the page out of static
// generation at build time.

import { Suspense } from 'react';
import WaitlistAuthShell from '@/components/waitlist/WaitlistAuthShell';

export default function WaitlistUserSignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FAF8F5] dark:bg-black" />}>
      <WaitlistAuthShell initialRole="user" initialMode="signup" />
    </Suspense>
  );
}
