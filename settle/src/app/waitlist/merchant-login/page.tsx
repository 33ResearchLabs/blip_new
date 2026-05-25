'use client';

// /waitlist/merchant-login — merchant sign-in entry point. State lives
// in WaitlistAuthShell so the User/Merchant + Sign up/Sign in toggles
// swap inner content without remounting the chrome.

import { Suspense } from 'react';
import WaitlistAuthShell from '@/components/waitlist/WaitlistAuthShell';

export default function WaitlistMerchantLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FAF8F5] dark:bg-black" />}>
      <WaitlistAuthShell initialRole="merchant" initialMode="signin" />
    </Suspense>
  );
}
