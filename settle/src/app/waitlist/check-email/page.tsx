'use client';

// /waitlist/check-email — shown immediately after signup. Tells the user to
// click the link in their inbox to activate the waitlist account.

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Mail, ArrowRight } from 'lucide-react';

function Content() {
  const params = useSearchParams();
  const email = params.get('email') ?? '';
  const role = params.get('role') === 'merchant' ? 'merchant' : 'user';
  const loginHref = role === 'merchant' ? '/waitlist/merchant-login' : '/waitlist/login';

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100 flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-[#39ff14]/10 border border-[#39ff14]/30 flex items-center justify-center mb-6">
          <Mail className="text-[#39ff14]" size={28} />
        </div>
        <h1 className="text-3xl font-bold mb-2">Check your inbox</h1>
        <p className="text-zinc-400 text-sm mb-8">
          We sent a verification link to{' '}
          <span className="font-mono text-[#39ff14]">{email || 'your email'}</span>.
          Click it to activate your waitlist account and unlock your dashboard.
        </p>
        <Link
          href={loginHref}
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-300 hover:text-[#39ff14] transition-colors"
        >
          Go to {role === 'merchant' ? 'merchant ' : ''}login <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}

export default function CheckEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#050505]" />}>
      <Content />
    </Suspense>
  );
}
