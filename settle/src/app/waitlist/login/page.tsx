'use client';

// /waitlist/login — user sign-in. Rendered inside WaitlistAuthShell so the
// User/Merchant + Sign up/Sign in toggles + role-switch CTA are shared
// across all four auth pages.

import LoginForm from '@/components/waitlist/LoginForm';
import WaitlistAuthShell from '@/components/waitlist/WaitlistAuthShell';

export default function WaitlistUserLoginPage() {
  return (
    <WaitlistAuthShell role="user" mode="signin">
      <LoginForm role="user" />
    </WaitlistAuthShell>
  );
}
