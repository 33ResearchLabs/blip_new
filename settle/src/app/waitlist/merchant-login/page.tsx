'use client';

// /waitlist/merchant-login — merchant sign-in. Renders inside the shared
// WaitlistAuthShell with role="merchant" / mode="signin" so the card
// shows merchant copy and the toggles route to the matching pages.

import LoginForm from '@/components/waitlist/LoginForm';
import WaitlistAuthShell from '@/components/waitlist/WaitlistAuthShell';

export default function WaitlistMerchantLoginPage() {
  return (
    <WaitlistAuthShell role="merchant" mode="signin">
      <LoginForm role="merchant" />
    </WaitlistAuthShell>
  );
}
