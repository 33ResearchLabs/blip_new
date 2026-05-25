'use client';

// Shared layout for the post-email landing pages
// (/user/verify-email, /user/forgot-password, /user/reset-password and
// their merchant mirrors). Mirrors the editorial cream + copper
// aesthetic of /waitlist/check-email and the transactional email
// templates so the journey from email → landing stays visually
// continuous.
//
// These pages sit OUTSIDE the WaitlistThemeProvider tree, so the
// styling is hard-coded to the light "cream" treatment instead of
// reading from theme tokens. That matches the email itself (which is
// always light) and is the right call for transactional landings — a
// surprise dark/light flip on the verify success screen would feel
// random.

import Image from 'next/image';
import { ReactNode } from 'react';
import WaitlistAuthNavbar from '@/components/waitlist/WaitlistAuthNavbar';

const ACCENT = '#cc785c';

interface Props {
  // Asset under /public/illustrations — defaults to the envelope used
  // by the verify-email mail.
  heroSrc?: string;
  eyebrow: string;
  headlineLead: string;
  headlineAccent: string;
  /** Slot for the state-specific UI (form / status / CTA). */
  children: ReactNode;
}

export default function EmailFlowShell({
  heroSrc = '/illustrations/verify-email-hero.png',
  eyebrow,
  headlineLead,
  headlineAccent,
  children,
}: Props) {
  return (
    <div className="relative min-h-screen bg-[#FAF8F5] text-[#1d1d1f]">
      <WaitlistAuthNavbar />

      <main className="relative z-10 max-w-[640px] mx-auto px-6 pt-14 md:pt-20 pb-20">
        <div
          className="bg-white border border-black/[0.06] rounded-[24px] overflow-hidden"
          style={{ boxShadow: '0 24px 50px -28px rgba(0,0,0,0.18)' }}
        >
          {/* Hero block — cream backdrop, illustration, copper eyebrow,
              italic-accent editorial headline, hairline copper rule
              marking the seam to the white body. */}
          <div className="px-7 pt-11 pb-9 text-center" style={{ background: '#FAF8F5' }}>
            <div className="flex justify-center">
              <Image
                src={heroSrc}
                alt=""
                width={180}
                height={180}
                priority
                className="rounded-[24px]"
              />
            </div>

            <p
              className="mt-6 text-[10px] font-bold tracking-[0.3em] uppercase"
              style={{ color: ACCENT }}
            >
              {eyebrow}
            </p>

            <h1
              className="font-display mt-3 text-[30px] leading-[1.05] tracking-[-0.03em] font-semibold"
              style={{ color: '#1d1d1f' }}
            >
              {headlineLead}{' '}
              <span style={{ fontStyle: 'italic', fontWeight: 500, color: ACCENT }}>
                {headlineAccent}
              </span>
            </h1>

            <div
              className="mt-8 mx-auto h-px max-w-[180px]"
              style={{ background: 'rgba(204,120,92,0.22)' }}
            />
          </div>

          {/* Body — white card. The page provides its own state UI here. */}
          <div className="px-7 pt-7 pb-7">{children}</div>

          {/* Footer — branded mono line, matches email templates */}
          <div
            className="px-7 py-5 border-t border-black/[0.06]"
            style={{ background: '#fafafa' }}
          >
            <p
              className="text-center text-[10px] tracking-[0.22em] uppercase text-black/45"
              style={{
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

// Small primitives so each page renders consistent buttons / pills /
// alerts without re-typing the same Tailwind every time.

export function EmailFlowPrimaryCta({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex w-full items-center justify-center gap-2 px-8 py-3.5 rounded-full text-[14.5px] font-semibold tracking-[-0.005em] transition-transform hover:-translate-y-[1px]"
      style={{
        background: '#0a0a0a',
        color: '#ffffff',
        boxShadow: '0 8px 22px -10px rgba(10,10,10,0.45)',
      }}
    >
      {children}
    </a>
  );
}

export function EmailFlowAccentPill({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div
      className="rounded-2xl p-4 flex items-center gap-3"
      style={{
        background:
          'linear-gradient(135deg, rgba(204,120,92,0.10) 0%, rgba(204,120,92,0.03) 100%)',
        border: '1px solid rgba(204,120,92,0.22)',
      }}
    >
      <div
        className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white"
        style={{ background: ACCENT }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[13.5px] font-bold tracking-[-0.005em] text-[#1d1d1f]">
          {title}
        </div>
        <div className="text-[11.5px] text-[#6e6e73] mt-0.5">{body}</div>
      </div>
    </div>
  );
}
