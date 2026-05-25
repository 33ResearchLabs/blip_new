'use client';

// Unified waitlist auth shell — replaces AuthPageLayout for the 4 auth
// surfaces (/waitlist/login, /waitlist/merchant-login, /waitlist/user,
// /waitlist/merchant). Editorial copy + bullet list + role-switch CTA on
// the left, a single card with User/Merchant + Sign up/Sign in pill
// toggles + slotted form body on the right. Theme is driven by the
// waitlist-scoped provider (see /waitlist/layout.tsx) — never by OS
// preference, so a user on macOS dark mode still sees the light theme
// unless they toggle it from the dashboard navbar.

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, Check } from 'lucide-react';
import { useWaitlistTokens } from '@/context/WaitlistThemeContext';
import WaitlistAuthNavbar from '@/components/waitlist/WaitlistAuthNavbar';

type Role = 'user' | 'merchant';
type Mode = 'signin' | 'signup';

const ACCENT = '#cc785c';

interface CopyBlock {
  eyebrow: string;
  headlineLead: string;
  headlineAccent: string;
  sub: string;
  bullets: string[];
  stat: string;
  cardTitle: string;
  cardSub: string;
}

const COPY: Record<Role, Record<Mode, CopyBlock>> = {
  user: {
    signin: {
      eyebrow: 'User · Welcome Back',
      headlineLead: 'Sign back in.',
      headlineAccent: 'Hold your place.',
      sub: 'Pick up where you left off — check your waitlist position, BLIP balance, and referrals.',
      bullets: [
        'See your live waitlist position',
        'Track your BLIP point balance',
        'Get notified the moment the app opens',
      ],
      stat: '2,840 users on the waitlist',
      cardTitle: 'Sign in to Blip.',
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
      stat: '2,840 users on the waitlist',
      cardTitle: 'Join the waitlist.',
      cardSub: 'Takes 30 seconds. Same login carries into the app.',
    },
  },
  merchant: {
    signin: {
      eyebrow: 'Merchant · Welcome Back',
      headlineLead: 'Welcome back, operator.',
      headlineAccent: 'The order book is live.',
      sub: 'Pick up where you left off — live orders, settlement queue, merchant earnings.',
      bullets: [
        'Live order routing and bid history',
        'Daily earnings, paid out instantly on-chain',
        'Leaderboard standing and founder perks',
      ],
      stat: '1,284 merchants on the network',
      cardTitle: 'Sign in as merchant.',
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
      cardTitle: 'Become a merchant.',
      cardSub: 'Takes 60 seconds. Same login carries into the merchant app.',
    },
  },
};

function pathFor(role: Role, mode: Mode): string {
  if (mode === 'signin') return role === 'merchant' ? '/waitlist/merchant-login' : '/waitlist/login';
  return role === 'merchant' ? '/waitlist/merchant' : '/waitlist/user';
}

interface SwitchRoleCardCopy {
  badge: string;
  badgeSub: string;
  body: string;
  ctaLabel: string;
}

// Keyed by the *current* role — describes the card shown on that role's
// page, which always invites a switch to the other role.
const SWITCH_CARD_COPY: Record<Role, SwitchRoleCardCopy> = {
  merchant: {
    badge: '3%',
    badgeSub: 'Better Rate',
    body: 'Get the best rates on the Blip market — up to 3% better than anywhere else.',
    ctaLabel: 'Switch to user',
  },
  user: {
    badge: '10%',
    badgeSub: 'Per Trade',
    body: 'Earn up to 10% on every transaction.',
    ctaLabel: 'Switch to merchant',
  },
};

interface Props {
  role: Role;
  mode: Mode;
  children: React.ReactNode;
}

export default function WaitlistAuthShell({ role, mode, children }: Props) {
  const t = useWaitlistTokens();
  const copy = COPY[role][mode];
  const otherRole: Role = role === 'merchant' ? 'user' : 'merchant';
  const switchCopy = SWITCH_CARD_COPY[role];
  const switchHref = pathFor(otherRole, mode);
  const altModeHref = pathFor(role, mode === 'signin' ? 'signup' : 'signin');
  const altModeLabel =
    mode === 'signin'
      ? (role === 'merchant' ? 'Register as Merchant' : 'Create one')
      : (role === 'merchant' ? 'Sign in as Merchant' : 'Sign in');

  const headingColor = t.d ? 'text-white' : 'text-[#1d1d1f]';
  const bodyColor = t.d ? 'text-white/80' : 'text-[#1d1d1f]';
  const bulletColor = t.d ? 'text-white/90' : 'text-[#1d1d1f]';
  const dividerColor = t.d ? 'bg-white/15' : 'bg-black/15';
  const checkBubble = t.d ? 'bg-white' : 'bg-[#1d1d1f]';
  const checkIcon = t.d ? 'text-black' : 'text-white';

  const navCurrent =
    role === 'merchant'
      ? (mode === 'signin' ? 'merchant-login' : 'merchant-register')
      : (mode === 'signin' ? 'user-login' : 'user-register');

  return (
    <div className={`relative min-h-screen ${t.bg} ${t.txt}`}>
      <WaitlistAuthNavbar current={navCurrent} />

      <main className="relative z-10 max-w-[1200px] mx-auto px-6 pt-14 md:pt-24 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_475px] gap-10 lg:gap-14 lg:items-start min-h-[80vh]">
          {/* LEFT — editorial copy */}
          <motion.div
            key={`${role}-${mode}-left`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center lg:text-left"
          >
            <div className="inline-flex items-center gap-3 mb-6">
              <span className={`w-5 h-px ${dividerColor}`} />
              <span className={`text-[10px] font-semibold tracking-[0.3em] uppercase whitespace-nowrap ${t.txt}`}>
                {copy.eyebrow}
              </span>
              <span className={`w-5 h-px ${dividerColor}`} />
            </div>

            <h1
              className={`font-semibold mb-4 leading-[1.02] tracking-[-0.045em] ${headingColor}`}
              style={{ fontSize: 'clamp(2rem, 4.4vw, 3rem)' }}
            >
              {copy.headlineLead}{' '}
              <span style={{ fontStyle: 'italic', fontWeight: 500, color: ACCENT }}>
                {copy.headlineAccent}
              </span>
            </h1>

            <p className={`text-[15.5px] leading-[1.5] tracking-tight max-w-[480px] mx-auto lg:mx-0 mb-7 ${bodyColor}`}>
              {copy.sub}
            </p>

            <ul className="space-y-3 max-w-[440px] mx-auto lg:mx-0 text-left mb-7">
              {copy.bullets.map((line) => (
                <li
                  key={line}
                  className={`flex items-start gap-3 text-[14.5px] font-medium ${bulletColor}`}
                >
                  <span className={`mt-[3px] inline-flex w-[18px] h-[18px] shrink-0 rounded-full items-center justify-center ${checkBubble}`}>
                    <Check className={`w-[11px] h-[11px] ${checkIcon}`} strokeWidth={3} />
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <p className={`text-[10px] font-semibold tracking-[0.18em] uppercase ${t.muted} mb-3`}>
              {copy.stat}
            </p>

            {/* Switch-to-other-role CTA card — keeps the dark treatment in
                both themes to act as a visual hook in the page. */}
            {/* The global ThemeContext's CSS rewrites `text-white` to dark
                when the app theme is on a light variant, which made the
                copy disappear on this dark card. Inline `color` styles
                bypass that override. */}
            <Link
              href={switchHref}
              className="group block max-w-[440px] mx-auto lg:mx-0 rounded-2xl overflow-hidden border border-black/[0.08] hover:opacity-95 transition"
              style={{ background: '#1d1d1f' }}
            >
              <div className="flex items-center gap-4 px-5 py-4">
                <div
                  className="shrink-0 text-left leading-tight pr-3"
                  style={{ borderRight: '1px solid rgba(255,255,255,0.10)' }}
                >
                  <div className="text-[28px] font-semibold leading-none" style={{ color: '#ffffff' }}>
                    {switchCopy.badge}
                  </div>
                  <div
                    className="text-[9px] font-semibold tracking-[0.2em] uppercase mt-1.5"
                    style={{ color: 'rgba(255,255,255,0.55)' }}
                  >
                    {switchCopy.badgeSub}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className="text-[9.5px] font-semibold tracking-[0.22em] uppercase mb-1"
                    style={{ color: 'rgba(255,255,255,0.50)' }}
                  >
                    {switchCopy.ctaLabel}
                  </div>
                  <p className="text-[12px] leading-snug" style={{ color: 'rgba(255,255,255,0.85)' }}>
                    {switchCopy.body}
                  </p>
                </div>
                <div
                  className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition"
                  style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}
                >
                  <ArrowRight className="w-4 h-4" style={{ color: '#ffffff' }} />
                </div>
              </div>
            </Link>
          </motion.div>

          {/* RIGHT — auth card */}
          <motion.div
            key={`${role}-${mode}-right`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 }}
            className="w-full max-w-[475px] mx-auto"
          >
            <div className={`${t.surface} border ${t.border} ${t.cardShadow} rounded-2xl p-6 md:p-7`}>
              <PillToggle
                value={role}
                options={[
                  { value: 'user', label: 'User', href: pathFor('user', mode) },
                  { value: 'merchant', label: 'Merchant', href: pathFor('merchant', mode) },
                ]}
              />

              <h2 className={`mt-5 text-[22px] md:text-[24px] font-semibold ${t.txt} tracking-tight`}>
                {copy.cardTitle}
              </h2>
              <p className={`mt-1.5 text-[13px] ${t.muted} leading-relaxed`}>
                {copy.cardSub}
              </p>

              <div className="mt-5">
                <PillToggle
                  value={mode === 'signup' ? 'signup' : 'signin'}
                  options={[
                    { value: 'signup', label: 'Sign up', href: pathFor(role, 'signup') },
                    { value: 'signin', label: 'Sign in', href: pathFor(role, 'signin') },
                  ]}
                />
              </div>

              <div className="mt-5">{children}</div>

              <div className={`mt-6 pt-4 border-t ${t.divider} text-center`}>
                <p className={`text-[13px] ${t.muted}`}>
                  {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
                  <Link href={altModeHref} className={`${t.txt} font-semibold hover:underline underline-offset-4`}>
                    {altModeLabel}
                  </Link>
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}

interface PillOption<T extends string> {
  value: T;
  label: string;
  href: string;
}

function PillToggle<T extends string>({
  value, options,
}: { value: T; options: ReadonlyArray<PillOption<T>> }) {
  const t = useWaitlistTokens();
  return (
    <div
      className="grid grid-cols-2 p-1 rounded-full"
      style={{ background: t.d ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const activeStyle: React.CSSProperties = active
          ? {
              background: t.d ? '#ffffff' : '#ffffff',
              color: '#000000',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)',
            }
          : {
              color: t.d ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)',
            };
        return (
          <Link
            key={opt.value}
            href={opt.href}
            className="text-center py-2 rounded-full text-[12.5px] font-semibold transition"
            style={activeStyle}
          >
            {opt.label}
          </Link>
        );
      })}
    </div>
  );
}

