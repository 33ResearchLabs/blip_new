'use client';

// /waitlist/check-email — shown immediately after signup. Mirrors the
// editorial cream + copper aesthetic of the rest of /waitlist/* and the
// transactional email templates (envelope-with-wax-seal hero,
// italic-accent headline, copper eyebrow, hairline rule, branded
// mono footer). Use the same WaitlistAuthNavbar so the page sits in
// the same navigation chrome as /waitlist/user, /waitlist/login, etc.

import { Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { useWaitlistTokens } from '@/context/WaitlistThemeContext';
import WaitlistAuthNavbar from '@/components/waitlist/WaitlistAuthNavbar';

const ACCENT = '#cc785c';

function Content() {
  const t = useWaitlistTokens();
  const params = useSearchParams();
  const email = params.get('email') ?? '';
  const role = params.get('role') === 'merchant' ? 'merchant' : 'user';
  const loginHref = role === 'merchant' ? '/waitlist/merchant-login' : '/waitlist/login';

  const headingColor = t.d ? '#ffffff' : '#1d1d1f';
  const bodyColor = t.d ? 'rgba(255,255,255,0.80)' : '#3a3a3c';
  const subtleColor = t.d ? 'rgba(255,255,255,0.55)' : '#6e6e73';

  return (
    <div className={`relative min-h-screen ${t.bg}`} style={{ color: headingColor }}>
      <WaitlistAuthNavbar />

      <main className="relative z-10 max-w-[640px] mx-auto px-6 pt-14 md:pt-20 pb-20">
        <div
          className={`${t.surface} border ${t.border} ${t.cardShadow} rounded-[24px] overflow-hidden`}
        >
          {/* Hero block — cream backdrop with the envelope illustration,
              copper eyebrow, italic-accent headline. Closes with a
              hairline copper rule before the white body. */}
          <div className="px-7 pt-11 pb-9 text-center" style={{ background: '#FAF8F5' }}>
            <div className="flex justify-center">
              <Image
                src="/illustrations/verify-email-hero.png"
                alt=""
                width={200}
                height={200}
                priority
                className="rounded-[24px]"
              />
            </div>

            <p
              className="mt-6 text-[10px] font-bold tracking-[0.3em] uppercase"
              style={{ color: ACCENT }}
            >
              Check your inbox
            </p>

            <h1
              className="font-display mt-3 text-[32px] leading-[1.05] tracking-[-0.03em] font-semibold"
              style={{ color: '#1d1d1f' }}
            >
              One tap to{' '}
              <span style={{ fontStyle: 'italic', fontWeight: 500, color: ACCENT }}>
                unlock your spot.
              </span>
            </h1>

            <div
              className="mt-8 mx-auto h-px max-w-[180px]"
              style={{ background: 'rgba(204,120,92,0.22)' }}
            />
          </div>

          {/* Body — white card. Email confirmation + reassurance + CTA. */}
          <div className="px-7 pt-7 pb-2 text-center">
            <p className="text-[15px] leading-[1.55]" style={{ color: bodyColor }}>
              We sent a verification link to{' '}
              {email ? (
                <span
                  className="font-semibold"
                  style={{
                    color: headingColor,
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, "Courier New", monospace',
                  }}
                >
                  {email}
                </span>
              ) : (
                <span className="font-semibold" style={{ color: headingColor }}>
                  your inbox
                </span>
              )}
              . Click it to activate your {role === 'merchant' ? 'merchant ' : ''}waitlist
              account and unlock your dashboard.
            </p>
            <p className="mt-3 text-[12.5px] leading-[1.55]" style={{ color: subtleColor }}>
              Link expires in{' '}
              <span className="font-semibold" style={{ color: headingColor }}>
                24 hours
              </span>
              . Can't find it? Check your spam folder.
            </p>
          </div>

          {/* CTA — primary "Go to login" pill */}
          <div className="px-7 pt-6 pb-7 flex justify-center">
            <Link
              href={loginHref}
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-full text-[14.5px] font-semibold tracking-[-0.005em] transition-transform hover:-translate-y-[1px]"
              style={{
                background: '#0a0a0a',
                color: '#ffffff',
                boxShadow: '0 8px 22px -10px rgba(10,10,10,0.45)',
              }}
            >
              Go to {role === 'merchant' ? 'merchant ' : ''}sign in
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {/* Footer — branded mono line, matches email templates */}
          <div
            className="px-7 py-5 border-t"
            style={{
              borderColor: t.d ? 'rgba(255,255,255,0.06)' : 'rgba(29,29,31,0.06)',
              background: t.d ? 'rgba(255,255,255,0.02)' : '#fafafa',
            }}
          >
            <p
              className="text-center text-[10px] tracking-[0.22em] uppercase"
              style={{
                color: subtleColor,
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, "Courier New", monospace',
              }}
            >
              © {new Date().getFullYear()} BLIP.MONEY &nbsp;·&nbsp; Fast. Simple. Blip.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function CheckEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FAF8F5]" />}>
      <Content />
    </Suspense>
  );
}
