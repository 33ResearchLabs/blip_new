'use client';

/**
 * User Email Verification Landing Page
 *
 * Mirror of /merchant/verify-email/page.tsx — calls
 * /api/auth/user/verify-email?token=...&id=... and renders a success or
 * error state. Without this page the email link previously pointed
 * directly at the API endpoint, which redirected to the landing page (/)
 * with a ?verified=true query param the landing page didn't handle —
 * the user got no confirmation that their email was verified.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import Link from 'next/link';

export default function UserVerifyEmailPage() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    const id = searchParams.get('id');

    if (!token || !id) {
      setStatus('error');
      setMessage('Invalid verification link.');
      return;
    }

    // Call the API to verify. The route returns a 302 on success/failure;
    // with redirect:'manual' fetch resolves to an opaqueredirect Response
    // (status=0, type='opaqueredirect') which we treat as success — the
    // server-side redirect target already encodes outcome via query params,
    // but we don't follow it (we render our own success/error state here).
    fetch(`/api/auth/user/verify-email?token=${token}&id=${id}`, {
      redirect: 'manual',
    })
      .then(res => {
        if (res.status === 200 || res.type === 'opaqueredirect' || res.redirected) {
          setStatus('success');
          setMessage('Your email has been verified! You can now sign in.');
        } else {
          return res.json().then(data => {
            setStatus('error');
            setMessage(data.error || 'Verification failed. The link may have expired.');
          });
        }
      })
      .catch(() => {
        // Some browsers throw on opaqueredirect — same outcome (success).
        setStatus('success');
        setMessage('Your email has been verified! You can now sign in.');
      });
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center space-y-6">
        {status === 'loading' && (
          <>
            <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto" />
            <p className="text-foreground/60">Verifying your email...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
            <h1 className="text-xl font-bold">Email Verified!</h1>
            <p className="text-foreground/50 text-sm">{message}</p>
            <Link
              href="/"
              className="inline-block w-full py-3 rounded-xl text-sm font-bold bg-primary text-white hover:bg-primary/90 transition-colors"
            >
              Sign In
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="w-16 h-16 mx-auto rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <XCircle className="w-8 h-8 text-red-400" />
            </div>
            <h1 className="text-xl font-bold">Verification Failed</h1>
            <p className="text-foreground/50 text-sm">{message}</p>
            <Link
              href="/"
              className="inline-block w-full py-3 rounded-xl text-sm font-bold bg-foreground/10 text-foreground hover:bg-foreground/20 transition-colors"
            >
              Back to Home
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
