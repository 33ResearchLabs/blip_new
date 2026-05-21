'use client';

// /waitlist/user — user registration. Ported design from futureStick's
// UserRegister.tsx: shared waitlist navbar, AuthPageLayout with the phone-
// card visual, "Get Started" badge + "Join Waitlist" heading. RegisterForm
// renders email + username + password (with strength meter) + confirm
// password + referral code. Layout pinned to 100vh (header + scrollable
// form column under it).

import { Suspense } from 'react';
import AuthPageLayout from '@/components/waitlist/AuthPageLayout';
import RegisterForm from '@/components/waitlist/RegisterForm';
import WaitlistAuthNavbar from '@/components/waitlist/WaitlistAuthNavbar';

function Content() {
  // 100vh: navbar pinned, the form column scrolls inside `<main>` if the
  // viewport is shorter than the content. AuthPageLayout has its own
  // vertical padding which we shrink here to fit more above the fold.
  return (
    <div className="h-screen flex flex-col bg-[#FAF8F5] dark:bg-black text-black dark:text-white overflow-hidden">
      <WaitlistAuthNavbar current="user-register" />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 py-4 md:py-6">
          <AuthPageLayout
            badge="Get Started"
            heading="Join User Waitlist"
            description="Join Blip Money and start earning rewards"
            variant="user"
          >
            <RegisterForm role="user" />
          </AuthPageLayout>
        </div>
      </main>
    </div>
  );
}

export default function WaitlistUserSignupPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-[#FAF8F5] dark:bg-black" />}>
      <Content />
    </Suspense>
  );
}
