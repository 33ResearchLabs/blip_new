'use client';

// /waitlist/merchant — merchant registration entry point. Same Suspense
// wrap as /waitlist/user (RegisterForm uses useSearchParams).

import { Suspense } from 'react';
import WaitlistAuthShell from '@/components/waitlist/WaitlistAuthShell';

export default function WaitlistMerchantSignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FAF8F5] dark:bg-black" />}>
      <WaitlistAuthShell initialRole="merchant" initialMode="signup" />
    </Suspense>
  );
}
