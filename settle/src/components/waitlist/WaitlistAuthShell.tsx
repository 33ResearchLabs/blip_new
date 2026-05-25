"use client";

// Unified waitlist auth shell — replaces AuthPageLayout for the 4 auth
// surfaces (/waitlist/login, /waitlist/merchant-login, /waitlist/user,
// /waitlist/merchant). Editorial copy + bullet list + role-switch CTA on
// the left, a single card with User/Merchant + Sign up/Sign in pill
// toggles + slotted form body on the right. Theme is driven by the
// waitlist-scoped provider (see /waitlist/layout.tsx) — never by OS
// preference, so a user on macOS dark mode still sees the light theme
// unless they toggle it from the dashboard navbar.
//
// Toggling role or mode happens entirely in client state so the page
// shell stays mounted across the switch — only the inner form fades
// via AnimatePresence. URL is kept in sync via history.replaceState so
// deep links and refreshes still hit the right variant.

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import { useWaitlistTokens } from "@/context/WaitlistThemeContext";
import WaitlistAuthNavbar from "@/components/waitlist/WaitlistAuthNavbar";
import LoginForm from "@/components/waitlist/LoginForm";
import RegisterForm from "@/components/waitlist/RegisterForm";

type Role = "user" | "merchant";
type Mode = "signin" | "signup";

const ACCENT = "#cc785c";

interface CopyBlock {
  eyebrow: string;
  headlineLead: string;
  headlineAccent: string;
  sub: string;
  bullets: string[];
  stat: string;
  cardTitle: string;
  cardSub: string;
  joiningBadge: string;
}

const COPY: Record<Role, Record<Mode, CopyBlock>> = {
  user: {
    signin: {
      eyebrow: "Welcome Back",
      headlineLead: "Sign back in.",
      headlineAccent: "Hold your place.",
      sub: "Pick up where you left off — check your waitlist position, BLIP balance, and referrals.",
      bullets: [
        "See your live waitlist position",
        "Track your BLIP point balance",
        "Get notified the moment the app opens",
      ],
      stat: "424 already in line",
      cardTitle: "Sign in to Blip.",
      cardSub: "Welcome back. Your spot is right where you left it.",
      joiningBadge: "SIGNING IN AS A USER",
    },
    signup: {
      eyebrow: "Early Access",
      headlineLead: "Reserve your spot.",
      headlineAccent: "Skip the line.",
      sub: "Borderless money, settled by verified merchants in under 60 seconds.",
      bullets: [
        "2,000 bonus points the moment you join",
        "Priority access when the network opens",
        "Refer a friend — both of you skip 5 spots",
      ],
      stat: "424 already in line",
      cardTitle: "Join the waitlist.",
      cardSub: "Takes 30 seconds. Same login carries into the app.",
      joiningBadge: "JOINING AS A USER",
    },
  },
  merchant: {
    signin: {
      eyebrow: "Merchant · Welcome Back",
      headlineLead: "Welcome back, operator.",
      headlineAccent: "The order book is live.",
      sub: "Pick up where you left off — live orders, settlement queue, merchant earnings.",
      bullets: [
        "Live order routing and bid history",
        "Daily earnings, paid out instantly on-chain",
        "Leaderboard standing and founder perks",
      ],
      stat: "1,284 merchants on the network",
      cardTitle: "Sign in as merchant.",
      cardSub: "Welcome back. Your orders are right where you left them.",
      joiningBadge: "SIGNING IN AS A MERCHANT",
    },
    signup: {
      eyebrow: "Founding Merchant",
      headlineLead: "Earn on every order.",
      headlineAccent: "Set your spread.",
      sub: "Settle real orders for verified users. Compete live, win the trade, capture your margin.",
      bullets: [
        "Zero settlement fees during the beta",
        "Priority routing — faster matching, more wins",
        "Founding merchant status, recognised on launch",
      ],
      stat: "1,284 merchants on the network",
      cardTitle: "Become a merchant.",
      cardSub: "Takes 60 seconds. Same login carries into the merchant app.",
      joiningBadge: "JOINING AS A MERCHANT",
    },
  },
};

function pathFor(role: Role, mode: Mode): string {
  if (mode === "signin")
    return role === "merchant" ? "/waitlist/merchant-login" : "/waitlist/login";
  return role === "merchant" ? "/waitlist/merchant" : "/waitlist/user";
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
    badge: "3%",
    badgeSub: "Better Rate",
    body: "Get the best rates on the Blip market — up to 3% better than anywhere else.",
    ctaLabel: "Switch to User",
  },
  user: {
    badge: "10%",
    badgeSub: "Per Trade",
    body: "Earn up to 10% on every transaction.",
    ctaLabel: "Switch to Merchant",
  },
};

interface Props {
  initialRole: Role;
  initialMode: Mode;
}

export default function WaitlistAuthShell({ initialRole, initialMode }: Props) {
  const t = useWaitlistTokens();
  const [role, setRole] = useState<Role>(initialRole);
  const [mode, setMode] = useState<Mode>(initialMode);

  // Apply role/mode without remounting the shell. Pushes the new URL via
  // history.replaceState so a refresh or share-link still lands on the
  // matching variant, but skips Next.js routing so the surrounding
  // chrome (navbar, hero column, card frame) doesn't re-mount —
  // AnimatePresence then fades only the body that actually changed.
  function apply(nextRole: Role, nextMode: Mode) {
    if (nextRole === role && nextMode === mode) return;
    setRole(nextRole);
    setMode(nextMode);
    if (typeof window !== "undefined") {
      const url = pathFor(nextRole, nextMode);
      window.history.replaceState(null, "", url);
    }
  }

  const copy = COPY[role][mode];
  const otherRole: Role = role === "merchant" ? "user" : "merchant";
  const switchCopy = SWITCH_CARD_COPY[role];
  const altModeLabel =
    mode === "signin"
      ? role === "merchant"
        ? "Register as Merchant"
        : "Create one"
      : role === "merchant"
        ? "Sign in as Merchant"
        : "Sign in";

  const headingColor = t.d ? "text-white" : "text-[#1d1d1f]";
  const bodyColor = t.d ? "text-white/80" : "text-[#1d1d1f]";
  const bulletColor = t.d ? "text-white/90" : "text-[#1d1d1f]";
  const dividerColor = t.d ? "bg-white/15" : "bg-black/15";
  const checkBubble = t.d ? "bg-white" : "bg-[#1d1d1f]";
  const checkIcon = t.d ? "text-black" : "text-white";

  const navCurrent =
    role === "merchant"
      ? mode === "signin"
        ? "merchant-login"
        : "merchant-register"
      : mode === "signin"
        ? "user-login"
        : "user-register";

  return (
    <div className={`relative min-h-screen ${t.bg} ${t.txt}`}>
      <WaitlistAuthNavbar current={navCurrent} />

      <main className="relative z-10 max-w-[1200px] mx-auto px-6 pt-14 md:pt-24 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_475px] gap-10 lg:gap-14 lg:items-start min-h-[80vh]">
          {/* LEFT — editorial copy */}
          <div className="text-center lg:text-left">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${role}-${mode}-left`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="inline-flex items-center gap-3 mb-6">
                  <span className={`w-5 h-px ${dividerColor}`} />
                  <span
                    className={`text-[10px] font-semibold tracking-[0.3em] uppercase whitespace-nowrap ${t.txt}`}
                  >
                    {copy.eyebrow}
                  </span>
                  <span className={`w-5 h-px ${dividerColor}`} />
                </div>

                <h1
                  className={`font-semibold mb-4 leading-[1.02] tracking-[-0.045em] ${headingColor}`}
                  style={{ fontSize: "clamp(2rem, 4.4vw, 3rem)" }}
                >
                  {copy.headlineLead}{" "}
                  <span
                    style={{
                      fontStyle: "italic",
                      fontWeight: 500,
                      color: ACCENT,
                    }}
                  >
                    {copy.headlineAccent}
                  </span>
                </h1>

                <p
                  className={`text-[15.5px] leading-[1.5] tracking-tight max-w-[480px] mx-auto lg:mx-0 mb-7 ${bodyColor}`}
                >
                  {copy.sub}
                </p>

                <ul className="space-y-3 max-w-[440px] mx-auto lg:mx-0 text-left mb-7">
                  {copy.bullets.map((line) => (
                    <li
                      key={line}
                      className={`flex items-start gap-3 text-[14.5px] font-medium ${bulletColor}`}
                    >
                      <span
                        className={`mt-[3px] inline-flex w-[18px] h-[18px] shrink-0 rounded-full items-center justify-center ${checkBubble}`}
                      >
                        <Check
                          className={`w-[11px] h-[11px] ${checkIcon}`}
                          strokeWidth={3}
                        />
                      </span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>

                <p
                  className={`text-[10px] font-semibold tracking-[0.18em] uppercase ${t.muted} mb-3`}
                >
                  {copy.stat}
                </p>
              </motion.div>
            </AnimatePresence>

            {/* Switch-to-other-role CTA card — keeps the dark treatment in
                both themes to act as a visual hook in the page. Stays
                outside AnimatePresence so the button doesn't flicker
                each time the user toggles mode without changing role.
                Subtle diagonal gradient + soft white border highlight
                so the card reads as a single elevated surface rather
                than a flat black rectangle. */}
            <button
              type="button"
              onClick={() => apply(otherRole, mode)}
              className="group block w-full max-w-[440px] mx-auto lg:mx-0 rounded-2xl overflow-hidden hover:opacity-[0.97] transition text-left relative"
              style={{
                // Two-layer dark base with a warm copper glow biased
                // toward the right edge so the card reads dark on the
                // left and orange-tinted on the right — matches the
                // marketing screenshot exactly.
                background:
                  "radial-gradient(120% 140% at 100% 50%, rgba(204,120,92,0.28) 0%, rgba(204,120,92,0.10) 35%, rgba(204,120,92,0) 65%), linear-gradient(95deg, #050505 0%, #0d0a08 55%, #181009 100%)",
                border: "1px solid rgba(255,255,255,0.06)",
                boxShadow:
                  "0 18px 40px -22px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)",
              }}
            >
              <div className="flex items-center gap-4 px-5 py-4 relative">
                <div
                  className="shrink-0 text-left leading-tight pr-4"
                  style={{ borderRight: "1px solid rgba(255,255,255,0.10)" }}
                >
                  <div
                    className="text-[30px] font-semibold leading-none tracking-tight"
                    style={{ color: "#ffffff" }}
                  >
                    {switchCopy.badge}
                  </div>
                  <div
                    className="text-[9px] font-semibold tracking-[0.22em] uppercase mt-2"
                    style={{ color: "rgba(255,255,255,0.55)" }}
                  >
                    {switchCopy.badgeSub}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className="text-[9.5px] font-semibold tracking-[0.24em] uppercase mb-1"
                    style={{ color: ACCENT }}
                  >
                    {switchCopy.ctaLabel}
                  </div>
                  <p
                    className="text-[12.5px] font-semibold leading-snug"
                    style={{ color: "#ffffff" }}
                  >
                    {switchCopy.body}
                  </p>
                </div>
                <div
                  className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition group-hover:translate-x-[1px]"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.14)",
                  }}
                >
                  <ArrowRight
                    className="w-4 h-4"
                    style={{ color: "#ffffff" }}
                  />
                </div>
              </div>
            </button>
          </div>

          {/* RIGHT — auth card. Frame stays mounted across role/mode
              switches so the user sees a continuous card; only the
              body fades via AnimatePresence below. */}
          <div className="w-full max-w-[475px] mx-auto">
            <div
              className={`${t.surface} border ${t.border} ${t.cardShadow} rounded-2xl p-6 md:p-7`}
            >
              <PillToggle
                value={role}
                options={[
                  { value: "user", label: "User" },
                  { value: "merchant", label: "Merchant" },
                ]}
                onChange={(next) => apply(next, mode)}
              />

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={`${role}-${mode}-head`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                >
                  <h2
                    className={`mt-5 text-[22px] md:text-[24px] font-semibold ${t.txt} tracking-tight`}
                  >
                    {copy.cardTitle}
                  </h2>
                  <p
                    className={`mt-1.5 text-[13px] ${t.muted} leading-relaxed`}
                  >
                    {copy.cardSub}
                  </p>
                </motion.div>
              </AnimatePresence>

              {/* JOINING AS / SIGNING IN AS pill + inline switch link.
                  Lives inside the card so the role context is obvious
                  the moment the user reads the title. */}
              <div className="mt-4 flex items-center justify-between gap-3">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={`${role}-${mode}-pill`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.16em]"
                    style={{ color: ACCENT }}
                  >
                    <span
                      className="relative inline-flex w-1.5 h-1.5 rounded-full"
                      style={{ background: ACCENT }}
                    >
                      <span
                        className="absolute inset-0 rounded-full animate-ping"
                        style={{ background: ACCENT, opacity: 0.6 }}
                      />
                    </span>
                    {copy.joiningBadge}
                  </motion.span>
                </AnimatePresence>
                <button
                  type="button"
                  onClick={() => apply(otherRole, mode)}
                  className={`text-[11.5px] font-semibold ${t.txt} hover:underline underline-offset-4 transition-colors`}
                >
                  Switch to {otherRole === "merchant" ? "Merchant" : "User"}
                </button>
              </div>

              <div className="mt-4">
                <PillToggle
                  value={mode === "signup" ? "signup" : "signin"}
                  options={[
                    { value: "signup", label: "Sign up" },
                    { value: "signin", label: "Sign in" },
                  ]}
                  onChange={(next) => apply(role, next)}
                />
              </div>

              {/* Form body. Keyed by role+mode so AnimatePresence handles
                  the full cross-fade for both axes. */}
              <div className="mt-5">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={`${role}-${mode}-form`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                  >
                    {mode === "signin" ? (
                      <LoginForm role={role} />
                    ) : (
                      <RegisterForm role={role} />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className={`mt-6 pt-4 border-t ${t.divider} text-center`}>
                <p className={`text-[13px] ${t.muted}`}>
                  {mode === "signin"
                    ? "Don't have an account?"
                    : "Already have an account?"}{" "}
                  <button
                    type="button"
                    onClick={() =>
                      apply(role, mode === "signin" ? "signup" : "signin")
                    }
                    className={`${t.txt} font-semibold hover:underline underline-offset-4`}
                  >
                    {altModeLabel}
                  </button>
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

interface PillOption<T extends string> {
  value: T;
  label: string;
}

function PillToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<PillOption<T>>;
  onChange: (next: T) => void;
}) {
  const t = useWaitlistTokens();
  return (
    <div
      className="grid grid-cols-2 p-1 rounded-full"
      style={{
        background: t.d ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const activeStyle: React.CSSProperties = active
          ? {
              background: "#ffffff",
              color: "#000000",
              boxShadow:
                "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)",
            }
          : {
              color: t.d ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.55)",
            };
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="text-center py-2 rounded-full text-[12.5px] font-semibold transition"
            style={activeStyle}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
