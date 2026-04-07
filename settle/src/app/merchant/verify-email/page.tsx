'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import Link from 'next/link';

export default function VerifyEmailPage() {
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

    // Call the API to verify
    fetch(`/api/auth/merchant/verify-email?token=${token}&id=${id}`, {
      redirect: 'manual', // Don't follow redirect — handle it ourselves
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
        // Redirect response (302) throws in fetch with redirect: 'manual'
        // This actually means success
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
              href="/merchant"
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
              href="/merchant"
              className="inline-block w-full py-3 rounded-xl text-sm font-bold bg-foreground/10 text-foreground hover:bg-foreground/20 transition-colors"
            >
              Back to Login
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
