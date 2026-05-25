'use client';

// /waitlist/user — user registration. Renders inside WaitlistAuthShell
// with role="user" / mode="signup". A Suspense boundary keeps RegisterForm's
// useSearchParams from forcing the page out of static generation at build.

import { Suspense } from 'react';
import RegisterForm from '@/components/waitlist/RegisterForm';
import WaitlistAuthShell from '@/components/waitlist/WaitlistAuthShell';

function Content() {
  return (
    <WaitlistAuthShell role="user" mode="signup">
      <RegisterForm role="user" />
    </WaitlistAuthShell>
  );
}

export default function WaitlistUserSignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FAF8F5] dark:bg-black" />}>
      <Content />
    </Suspense>
  );
}
