'use client';

// Unified waitlist auth shell — pixel-ports the futureStick
// UserRegister / MerchantRegister layout (and their Login mirrors)
// onto the Next.js side. The two-column composition (editorial copy +
// white auth card) and all typography, padding, and copy tokens are
// taken verbatim from
//   /Users/zzz/Projects/Blip-money-futureStick/blip-protocol-ui/src/pages/Waitlist/UserRegister.tsx
//   /Users/zzz/Projects/Blip-money-futureStick/blip-protocol-ui/src/pages/Waitlist/MerchantRegister.tsx
// so /waitlist/user, /waitlist/merchant, /waitlist/login, and
// /waitlist/merchant-login render the same shell with role/mode
// configuration. The form body itself is slotted as `children`
// (RegisterForm / LoginForm).

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, Check } from 'lucide-react';
import { useWaitlistTokens } from '@/context/WaitlistThemeContext';
import WaitlistAuthNavbar from '@/components/waitlist/WaitlistAuthNavbar';
import RegisterForm from '@/components/waitlist/RegisterForm';
import LoginForm from '@/components/waitlist/LoginForm';

type Role = 'user' | 'merchant';
type Mode = 'signin' | 'signup';

const ACCENT = '#cc785c';
const EASE = [0.16, 1, 0.3, 1] as const;

interface CopyBlock {
  eyebrow: string;
  headlineLead: string;
  headlineAccent: string;
  sub: string;
  bullets: string[];
  stat: string;
  cardTitleLead: string;
  cardTitleAccent: string;
  cardSub: string;
}

const COPY: Record<Role, Record<Mode, CopyBlock>> = {
  user: {
    signin: {
      eyebrow: 'Welcome Back',
      headlineLead: 'Sign back in.',
      headlineAccent: 'Hold your place.',
      sub: 'Pick up where you left off — check your waitlist position, BLIP balance, and referrals.',
      bullets: [
        'See your live waitlist position',
        'Track your BLIP point balance',
        'Get notified the moment the app opens',
      ],
      stat: '122 already in line',
      cardTitleLead: 'Sign in to',
      cardTitleAccent: 'Blip.',
      cardSub: 'Welcome back. Your spot is right where you left it.',
    },
    signup: {
      eyebrow: 'Early Access',
      headlineLead: 'Reserve your spot.',
      headlineAccent: 'Skip the line.',
      sub: 'Borderless money, settled by verified merchants in under 60 seconds.',
      bullets: [
        '2,000 bonus points the moment you join',
        'Priority access when the network opens',
        'Refer a friend — both of you skip 5 spots',
      ],
      stat: '424 already in line',
      cardTitleLead: 'Join the',
      cardTitleAccent: 'waitlist.',
      cardSub: 'Takes 30 seconds. Same login carries into the app.',
    },
  },
  merchant: {
    signin: {
      eyebrow: 'Welcome Back',
      headlineLead: 'Welcome back, operator.',
      headlineAccent: 'The order book is live.',
      sub: 'Pick up where you left off — live orders, settlement queue, merchant earnings.',
      bullets: [
        'Live order routing and bid history',
        'Daily earnings, paid out instantly on-chain',
        'Leaderboard standing and founder perks',
      ],
      stat: '1,284 merchants already onboarded',
      cardTitleLead: 'Sign in as a',
      cardTitleAccent: 'merchant.',
      cardSub: 'Welcome back. Your orders are right where you left them.',
    },
    signup: {
      eyebrow: 'Founding Merchant',
      headlineLead: 'Earn on every order.',
      headlineAccent: 'Set your spread.',
      sub: 'Settle real orders for verified users. Compete live, win the trade, capture your margin.',
      bullets: [
        'Zero settlement fees during the beta',
        'Priority routing — faster matching, more wins',
        'Founding merchant status, recognised on launch',
      ],
      stat: '1,284 merchants on the network',
      cardTitleLead: 'Become a',
      cardTitleAccent: 'merchant.',
      cardSub: 'Takes 60 seconds. Same login carries into the merchant app.',
    },
  },
};

// Signup bonus card copy — production blip.money/signup shows this card
// between the bullets and the stat line on both user and merchant signup
// surfaces. Points figure is editorial copy only (the actual bonus is
// credited via MERCHANT_BLIP_POINTS.REGISTER / USER_BLIP_POINTS.REGISTER
// — see settle/src/lib/waitlist/blipPoints.ts).
const SIGNUP_BONUS: Record<Role, { headline: string; sub: string }> = {
  merchant: {
    headline: '+10,000 BLIP points',
    sub: 'Auto-credited after email verification',
  },
  user: {
    headline: '+5,000 BLIP points',
    sub: 'Auto-credited after email verification',
  },
};

function pathFor(role: Role, mode: Mode): string {
  if (mode === 'signin') return role === 'merchant' ? '/waitlist/merchant-login' : '/waitlist/login';
  return role === 'merchant' ? '/waitlist/merchant' : '/waitlist/user';
}

interface CrossSellCopy {
  stat: string;
  statLabel: string;
  eyebrow: string;
  title: string;
}

// Shown on both signup surfaces (mirrors production blip.money/signup —
// /waitlist/user invites a switch to merchant with the trade-margin
// pitch, /waitlist/merchant invites a switch to user with the cashback
// pitch). futureStick only shipped this on the merchant page; we extend
// it to user as well to match production.
const CROSS_SELL: Record<Role, CrossSellCopy> = {
  merchant: {
    stat: '5%',
    statLabel: 'Cashback',
    eyebrow: 'Sign up as a User',
    title: 'Earn up to 5% cashback on every transaction',
  },
  user: {
    stat: '10%',
    statLabel: 'Per Trade',
    eyebrow: 'Switch to Merchant',
    title: 'Earn up to 10% on every transaction',
  },
};

interface Props {
  initialRole: Role;
  initialMode: Mode;
}

export default function WaitlistAuthShell({ initialRole, initialMode }: Props) {
  // Role + mode are state-held in the shell — the segmented controls
  // below swap inner content without a route change. Pages
  // (/waitlist/user, /waitlist/merchant, /waitlist/login,
  // /waitlist/merchant-login) just seed the initial values.
  const [role, setRole] = useState<Role>(initialRole);
  const [mode, setMode] = useState<Mode>(initialMode);

  const t = useWaitlistTokens();
  const copy = COPY[role][mode];
  const otherRole: Role = role === 'merchant' ? 'user' : 'merchant';
  const crossSell = CROSS_SELL[role];
  const crossSellHref = pathFor(otherRole, mode);
  // altModeHref removed — the altMode link is now a state-update button
  // (calls setMode) rather than a navigation Link, so it doesn't need
  // a target route.
  const altModeLabel =
    mode === 'signin'
      ? (role === 'merchant' ? 'Register as Merchant' : 'Create one')
      : (role === 'merchant' ? 'Merchant Sign In' : 'Sign in');

  // futureStick uses explicit hex values for the editorial column rather
  // than theme tokens so it stays readable even when the surrounding theme
  // CSS rewrites text-white in light mode.
  const headingColor = t.d ? '#ffffff' : '#1d1d1f';
  const bodyColor = t.d ? 'rgba(255,255,255,0.80)' : '#3a3a3c';
  const bulletColor = t.d ? 'rgba(255,255,255,0.90)' : '#1d1d1f';
  const dividerColor = t.d ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
  const statColor = t.d ? 'rgba(255,255,255,0.65)' : '#3a3a3c';
  // Check bubble in bullets: dark ink on light theme, white on dark.
  const checkBg = t.d ? '#ffffff' : '#1d1d1f';
  const checkInk = t.d ? '#1d1d1f' : '#ffffff';

  const navCurrent =
    role === 'merchant'
      ? (mode === 'signin' ? 'merchant-login' : 'merchant-register')
      : (mode === 'signin' ? 'user-login' : 'user-register');

  // Production blip.money/signup shows the cross-sell card on both user
  // and merchant signup surfaces (user → "10% Per Trade", merchant →
  // "5% Cashback"). Keep it signup-only so signin pages stay focused.
  const showCrossSell = mode === 'signup';
  const showBonusCard = mode === 'signup';

  return (
    <div
      className={`relative min-h-screen ${t.bg}`}
      style={{
        color: headingColor,
        // futureStick's tailwind config sets Inter as the FIRST font in
        // both `sans` and `display` family stacks. Our globals.css body
        // puts -apple-system first (SF Pro on macOS), and SF Pro's
        // glyphs are noticeably narrower than Inter — that's why our
        // headline was sitting on a single line where production wraps
        // to "Reserve your spot. / Skip the line." `--font-geist-sans`
        // is already Inter (loaded via next/font in layout.tsx), so we
        // pin it explicitly on the waitlist auth surface to match.
        fontFamily:
          'var(--font-geist-sans), Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      }}
    >
      <WaitlistAuthNavbar current={navCurrent} />

      <main className="relative z-10 max-w-[1200px] mx-auto px-4 sm:px-6 pt-8 md:pt-20 pb-12 md:pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_475px] gap-10 lg:gap-14 items-center min-h-[80vh]">
          {/* ── LEFT — editorial copy. Hidden on mobile (<lg) where the
                user has a tiny viewport: the form alone reads cleaner
                than form + chunky hero copy stacked above it. The
                desktop / tablet hero is unchanged. */}
          <motion.div
            key={`${role}-${mode}-left`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: EASE }}
            className="hidden lg:block text-center lg:text-left"
          >
            <div className="inline-flex items-center gap-3 mb-7">
              <span className="w-5 h-px" style={{ background: dividerColor }} />
              <span
                className="text-[10px] font-semibold tracking-[0.3em] uppercase whitespace-nowrap"
                style={{ color: headingColor }}
              >
                {copy.eyebrow}
              </span>
              <span className="w-5 h-px" style={{ background: dividerColor }} />
            </div>

            {/* h1 deliberately has NO max-width — futureStick lets the
                grid column (1.15fr inside max-w-[1200px] minus the 475px
                right card and gap) constrain the wrap. That math lands
                around ~660px on the left column at the design's
                breakpoint, which is exactly enough to break the headline
                into "Reserve your spot. Skip the" / "line." at 48px font. */}
            <h1
              style={{
                fontSize: 'clamp(2rem, 4.4vw, 3rem)',
                fontWeight: 600,
                lineHeight: 1.02,
                letterSpacing: '-0.045em',
                color: headingColor,
                marginBottom: 16,
              }}
            >
              {copy.headlineLead}{' '}
              <span style={{ fontStyle: 'italic', fontWeight: 500, color: ACCENT }}>
                {copy.headlineAccent}
              </span>
            </h1>

            <p
              className="text-[15.5px] leading-[1.5] tracking-tight max-w-[480px] mx-auto lg:mx-0 mb-7"
              style={{ color: bodyColor }}
            >
              {copy.sub}
            </p>

            <ul className="space-y-3 max-w-[440px] mx-auto lg:mx-0 text-left mb-7">
              {copy.bullets.map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-3 text-[14.5px] font-medium"
                  style={{ color: bulletColor }}
                >
                  <span
                    className="mt-[3px] inline-flex w-[18px] h-[18px] shrink-0 rounded-full items-center justify-center"
                    style={{ background: checkBg }}
                  >
                    <Check className="w-[11px] h-[11px]" strokeWidth={3} style={{ color: checkInk }} />
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            {showBonusCard && (
              <div
                className="max-w-[440px] mx-auto lg:mx-0 mb-5 inline-flex items-center gap-3 pl-2 pr-5 py-2 rounded-2xl"
                style={{
                  background: t.d ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
                  border: t.d
                    ? '1px solid rgba(255,255,255,0.08)'
                    : '1px solid rgba(0,0,0,0.06)',
                }}
              >
                <span
                  className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-xl"
                  style={{ background: '#1d1d1f' }}
                >
                  <Check className="w-[18px] h-[18px]" strokeWidth={3} style={{ color: '#ffffff' }} />
                </span>
                <span className="leading-tight">
                  <span
                    className="block text-[13.5px]"
                    style={{ color: headingColor }}
                  >
                    <span style={{ fontWeight: 700 }}>{SIGNUP_BONUS[role].headline}</span>
                    <span style={{ fontWeight: 500 }}> on signup</span>
                  </span>
                  <span
                    className="block text-[11.5px] mt-0.5"
                    style={{ color: statColor }}
                  >
                    {SIGNUP_BONUS[role].sub}
                  </span>
                </span>
              </div>
            )}

            <p
              className="text-[11px] tracking-[0.18em] uppercase font-semibold mb-3"
              style={{ color: statColor }}
            >
              {copy.stat}
            </p>

            {showCrossSell && (
              <div className="mt-7">
                <CrossSellCard
                  href={crossSellHref}
                  stat={crossSell.stat}
                  statLabel={crossSell.statLabel}
                  eyebrow={crossSell.eyebrow}
                  title={crossSell.title}
                />
              </div>
            )}
          </motion.div>

          {/* ── RIGHT — auth card ─────────────────────────────────── */}
          <motion.div
            key={`${role}-${mode}-right`}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: EASE, delay: 0.1 }}
            className="w-full max-w-[440px] mx-auto lg:max-w-none lg:mx-0"
          >
            <div
              className="rounded-[24px] border border-black/[0.06] p-5 sm:p-7"
              style={{
                background: t.d ? '#0f0f0f' : '#ffffff',
                color: t.d ? '#ffffff' : '#1d1d1f',
                boxShadow:
                  '0 40px 100px -36px rgba(0,0,0,0.18), 0 16px 40px -20px rgba(0,0,0,0.08)',
              }}
            >
              {/* User / Merchant role pill — Apple segmented control at the
                  top of the card. State-held (setRole) so the toggle
                  swaps inner content without a route change. */}
              <div
                className="mb-4 grid grid-cols-2 p-[3px] rounded-full"
                style={{ background: t.d ? 'rgba(255,255,255,0.06)' : '#EFEFF2' }}
              >
                <button
                  type="button"
                  onClick={() => setRole('user')}
                  aria-current={role === 'user' ? 'page' : undefined}
                  className="py-3 rounded-full text-[13px] font-semibold text-center transition-colors duration-200"
                  style={
                    role === 'user'
                      ? {
                          background: t.d ? 'rgba(255,255,255,0.12)' : '#ffffff',
                          color: t.d ? '#ffffff' : '#000000',
                          boxShadow:
                            '0 1px 2px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.08)',
                        }
                      : { color: t.d ? 'rgba(255,255,255,0.85)' : '#1d1d1f' }
                  }
                >
                  User
                </button>
                <button
                  type="button"
                  onClick={() => setRole('merchant')}
                  aria-current={role === 'merchant' ? 'page' : undefined}
                  className="py-3 rounded-full text-[13px] font-semibold text-center transition-colors duration-200"
                  style={
                    role === 'merchant'
                      ? {
                          background: t.d ? 'rgba(255,255,255,0.12)' : '#ffffff',
                          color: t.d ? '#ffffff' : '#000000',
                          boxShadow:
                            '0 1px 2px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.08)',
                        }
                      : { color: t.d ? 'rgba(255,255,255,0.85)' : '#1d1d1f' }
                  }
                >
                  Merchant
                </button>
              </div>

              <div className="mb-5">
                {/* Card title renders as a single tone (black in light /
                    white in dark) — production blip.money/signup does
                    NOT use the orange italic accent on "waitlist." /
                    "merchant." that the futureStick source file has.
                    Joining the two parts with a plain space keeps the
                    h2 visually homogeneous. */}
                <h2
                  style={{
                    fontSize: '1.65rem',
                    fontWeight: 600,
                    letterSpacing: '-0.035em',
                    lineHeight: 1.05,
                    color: t.d ? '#ffffff' : '#1d1d1f',
                  }}
                >
                  {copy.cardTitleLead} {copy.cardTitleAccent}
                </h2>
                <p
                  className="mt-1.5 text-[12.5px]"
                  style={{ color: t.d ? 'rgba(255,255,255,0.70)' : '#3a3a3c' }}
                >
                  {copy.cardSub}
                </p>
              </div>

              {/* Role chip + quick switch — futureStick Register.tsx 326–347.
                  Shown on all four surfaces so the role is unambiguous. */}
              <div className="flex items-center justify-between mb-3">
                <div
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.18em]"
                  style={{
                    background: 'rgba(204,120,92,0.10)',
                    color: ACCENT,
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: ACCENT }}
                  />
                  Joining as {role === 'merchant' ? 'a Merchant' : 'a User'}
                </div>
                <button
                  type="button"
                  onClick={() => setRole(otherRole)}
                  className="text-[11px] font-semibold underline underline-offset-4 transition-colors"
                  style={{
                    color: t.d ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)',
                    background: 'transparent',
                  }}
                >
                  Switch to {role === 'merchant' ? 'User' : 'Merchant'}
                </button>
              </div>

              {/* Apple segmented control — Sign up / Sign in. State-held
                  (setMode) so the toggle swaps the inner form without a
                  route change. */}
              <div
                className="mb-4 grid grid-cols-2 p-[3px] rounded-full"
                style={{ background: t.d ? 'rgba(255,255,255,0.06)' : '#EFEFF2' }}
              >
                <button
                  type="button"
                  onClick={() => setMode('signup')}
                  aria-current={mode === 'signup' ? 'page' : undefined}
                  className="py-3 rounded-full text-[13px] font-semibold text-center transition-colors duration-200"
                  style={
                    mode === 'signup'
                      ? {
                          background: t.d ? 'rgba(255,255,255,0.12)' : '#ffffff',
                          color: t.d ? '#ffffff' : '#000000',
                          boxShadow:
                            '0 1px 2px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.08)',
                        }
                      : { color: t.d ? 'rgba(255,255,255,0.85)' : '#1d1d1f' }
                  }
                >
                  Sign up
                </button>
                <button
                  type="button"
                  onClick={() => setMode('signin')}
                  aria-current={mode === 'signin' ? 'page' : undefined}
                  className="py-3 rounded-full text-[13px] font-semibold text-center transition-colors duration-200"
                  style={
                    mode === 'signin'
                      ? {
                          background: t.d ? 'rgba(255,255,255,0.12)' : '#ffffff',
                          color: t.d ? '#ffffff' : '#000000',
                          boxShadow:
                            '0 1px 2px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.08)',
                        }
                      : { color: t.d ? 'rgba(255,255,255,0.85)' : '#1d1d1f' }
                  }
                >
                  Sign in
                </button>
              </div>

              {/* Form body — picked from mode so toggling Sign up/Sign in
                  swaps in-place. Keying on role+mode resets internal form
                  state when the user flips role. */}
              <div>
                {mode === 'signup' ? (
                  <RegisterForm key={`reg-${role}`} role={role} />
                ) : (
                  <LoginForm key={`login-${role}`} role={role} />
                )}
              </div>

              {/* Footer — altMode link + (signup-only) Terms / Privacy
                  copy. */}
              <div className="mt-4 text-center space-y-1">
                <p
                  className="text-[13.5px]"
                  style={{ color: t.d ? 'rgba(255,255,255,0.85)' : '#1d1d1f' }}
                >
                  {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
                  <button
                    type="button"
                    onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
                    className="font-semibold hover:underline underline-offset-4 transition-colors duration-200"
                    style={{ color: t.d ? '#ffffff' : '#000000', background: 'transparent' }}
                  >
                    {altModeLabel}
                  </button>
                </p>
                {mode === 'signup' && (
                  <p
                    className="text-[12px] leading-relaxed"
                    style={{ color: t.d ? 'rgba(255,255,255,0.80)' : '#1d1d1f' }}
                  >
                    By creating an account, you agree to our{' '}
                    <a
                      href="https://blip.money/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 transition-colors duration-200"
                      style={{ color: t.d ? 'rgba(255,255,255,0.80)' : '#1d1d1f' }}
                    >
                      Terms of Service
                    </a>{' '}
                    and{' '}
                    <a
                      href="https://blip.money/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 transition-colors duration-200"
                      style={{ color: t.d ? 'rgba(255,255,255,0.80)' : '#1d1d1f' }}
                    >
                      Privacy Policy
                    </a>
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}

// ── Cross-sell card ──────────────────────────────────────────────────
// Port of futureStick CrossSellCard (src/components/auth/CrossSellCard.tsx).
// Dark gradient surface, big editorial stat on the left, eyebrow +
// takeaway on the right, arrow chip. Same visual as the original — the
// only swap is the link is next/link, not react-router.
function CrossSellCard({
  href,
  stat,
  statLabel,
  eyebrow,
  title,
}: {
  href: string;
  stat: string;
  statLabel: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <Link
      href={href}
      className="group w-full max-w-[440px] mx-auto lg:mx-0 relative overflow-hidden rounded-2xl block text-left transition-transform hover:-translate-y-[2px]"
      style={{
        background: 'linear-gradient(135deg, #0a0a0a 0%, #1d1d1f 100%)',
        boxShadow:
          '0 24px 60px -24px rgba(0,0,0,0.55), 0 8px 24px -12px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)',
      }}
    >
      {/* Iridescent sheen on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700"
        style={{
          background:
            'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.06) 50%, transparent 70%)',
        }}
      />
      {/* Warm corner glow */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-10 w-48 h-48 rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(204,120,92,0.22) 0%, rgba(204,120,92,0) 65%)',
          filter: 'blur(2px)',
        }}
      />

      <div className="relative z-10 px-5 py-4 flex items-center gap-4">
        {/* Hero stat */}
        <div className="flex flex-col leading-none shrink-0">
          <span
            style={{
              fontSize: '44px',
              fontWeight: 600,
              letterSpacing: '-0.06em',
              lineHeight: 0.95,
              color: '#ffffff',
            }}
          >
            {stat}
          </span>
          <span
            className="text-[9px] font-semibold tracking-[0.22em] uppercase mt-1.5"
            style={{ color: 'rgba(255,255,255,0.45)' }}
          >
            {statLabel}
          </span>
        </div>

        <span
          aria-hidden
          className="h-12 w-px shrink-0"
          style={{ background: 'rgba(255,255,255,0.10)' }}
        />

        {/* Copy */}
        <div className="flex-1 min-w-0">
          <div
            className="text-[10px] font-semibold tracking-[0.22em] uppercase mb-1"
            style={{ color: ACCENT }}
          >
            {eyebrow}
          </div>
          <p
            className="text-[13px] font-semibold leading-snug"
            style={{ letterSpacing: '-0.01em', color: '#ffffff' }}
          >
            {title}
          </p>
        </div>

        {/* Arrow chip */}
        <span
          className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full transition-transform group-hover:translate-x-0.5"
          style={{ background: 'rgba(255,255,255,0.10)', color: '#ffffff' }}
          aria-hidden
        >
          <ArrowRight className="w-3.5 h-3.5" />
        </span>
      </div>
    </Link>
  );
}
