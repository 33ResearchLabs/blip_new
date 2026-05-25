'use client';

// /waitlist/merchant — merchant registration. Renders inside
// WaitlistAuthShell with role="merchant" / mode="signup".

import { Suspense } from 'react';
import RegisterForm from '@/components/waitlist/RegisterForm';
import WaitlistAuthShell from '@/components/waitlist/WaitlistAuthShell';

function Content() {
  return (
    <WaitlistAuthShell role="merchant" mode="signup">
      <RegisterForm role="merchant" />
    </WaitlistAuthShell>
  );
}

export default function WaitlistMerchantSignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FAF8F5] dark:bg-black" />}>
      <Content />
    </Suspense>
  );
}
