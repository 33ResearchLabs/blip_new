'use client';

// /waitlist — no chooser UI. Visiting /waitlist redirects to the user
// signup form by default. Merchants hit /waitlist/merchant directly.
// The ?ref=CODE query (if any) is forwarded through so referral credit is
// preserved either way.

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function Redirector() {
  const router = useRouter();
  const ref = useSearchParams().get('ref') ?? '';
  useEffect(() => {
    const dest = ref ? `/waitlist/user?ref=${encodeURIComponent(ref)}` : '/waitlist/user';
    router.replace(dest);
  }, [router, ref]);
  return <div className="min-h-screen bg-[#FAF8F5] dark:bg-black" />;
}

export default function WaitlistEntryPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FAF8F5] dark:bg-black" />}>
      <Redirector />
    </Suspense>
  );
}
