"use client";

// Merchant Rewards — Blip Points overview.
//
// DISPLAY-ONLY first pass: every number/state below comes from the local
// constants in this file, NOT the backend. The real economy already exists
// (merchants.blip_points, blip_point_log, /api/coins/me, the AMOUNTS table in
// src/lib/coins/awards.ts) — when we wire this up, swap REWARDS_DATA for a
// fetch to /api/merchant/rewards and keep the same shape.
//
// Responsive shell mirrors the merchant Settings page: MerchantNavbar on top,
// a back-arrow + "Rewards" title on mobile, full-width navbar + centered
// content column on desktop.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Coins,
  Sparkles,
  UserCircle,
  ArrowLeftRight,
  TrendingUp,
  Star,
  Flame,
  ShieldCheck,
  UserPlus,
  Check,
  ChevronRight,
  Copy,
  BadgeCheck,
  Gift,
  Send,
  Instagram,
  MessageCircle,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";
import { MerchantNavbar } from "@/components/merchant/MerchantNavbar";
import { useMerchantStore } from "@/stores/merchantStore";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { copyToClipboard } from "@/lib/clipboard";
import { formatCount } from "@/lib/format";

// X (formerly Twitter) brand mark — Lucide has no first-party X glyph, so this
// inline SVG matches the brand's current logo while accepting the same
// className prop as a LucideIcon (drops into the task list without a widen).
const XIcon: LucideIcon = (({
  className,
  ...rest
}: {
  className?: string;
  [k: string]: unknown;
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
    {...rest}
  >
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817-5.965 6.817H1.68l7.73-8.835L1.254 2.25h6.825l4.713 6.231 5.452-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z" />
  </svg>
)) as unknown as LucideIcon;

// ─── Static display data (swap for /api/merchant/rewards later) ────────────

interface OneOffTask {
  key: string;
  Icon: LucideIcon;
  title: string;
  description: string;
  points: number;
  done: boolean;
  /** Where the "Earn" CTA links when the task isn't done yet. */
  href?: string;
}

interface EarnRule {
  key: string;
  Icon: LucideIcon;
  title: string;
  description: string;
  /** Pre-formatted label, e.g. "+5" or "+1 / $50". */
  points: string;
}

// One-off tasks. `done` is hard-coded for the mockup so both visual states
// (completed vs. available) are visible. Point values match awards.ts /
// onboarding.ts so the display is true to the real economy.
const GETTING_STARTED: OneOffTask[] = [
  {
    key: "welcome",
    Icon: Sparkles,
    title: "Welcome aboard",
    description: "Granted when you create your merchant account.",
    points: 100,
    done: true,
  },
  {
    key: "profile",
    Icon: UserCircle,
    title: "Complete your profile",
    description: "Add a display name, a bio, and an avatar.",
    points: 50,
    done: true,
    href: "/market/settings?tab=profile",
  },
  {
    key: "x",
    Icon: XIcon,
    title: "Verify your X account",
    description: "Link and verify your X (Twitter) handle.",
    points: 50,
    done: false,
    href: "/market/settings?tab=limits",
  },
  {
    key: "first_trade",
    Icon: ArrowLeftRight,
    title: "Complete your first trade",
    description: "Finish your first order as a merchant.",
    points: 200,
    done: false,
  },
];

// Repeatable earn rules — straight from the AMOUNTS table in awards.ts.
const KEEP_EARNING: EarnRule[] = [
  {
    key: "trade",
    Icon: ArrowLeftRight,
    title: "Complete a trade",
    description: "Earned on every completed order.",
    points: "+5",
  },
  {
    key: "volume",
    Icon: TrendingUp,
    title: "Trade volume",
    description: "For every $50 of trade volume.",
    points: "+1",
  },
  {
    key: "five_star",
    Icon: Star,
    title: "Earn a 5-star rating",
    description: "When a counterparty rates you 5★.",
    points: "+10",
  },
  {
    key: "streak_7",
    Icon: Flame,
    title: "7-day activity streak",
    description: "Trade 7 days in a row.",
    points: "+50",
  },
  {
    key: "streak_30",
    Icon: Flame,
    title: "30-day activity streak",
    description: "Trade 30 days in a row.",
    points: "+300",
  },
  {
    key: "dispute_free",
    Icon: ShieldCheck,
    title: "Dispute-free month",
    description: "A full calendar month with no disputes.",
    points: "+100",
  },
  {
    key: "referral",
    Icon: UserPlus,
    title: "Refer a merchant",
    description: "When your referral makes their first trade.",
    points: "+200",
  },
];

// Mock balance — kept consistent with the `done` tasks above (100 + 50).
const REWARDS_DATA = {
  balance: 150,
  lifetimeEarned: 150,
  locked: 0,
};

// ─── Number easing for the hero counter ────────────────────────────────────

function useAnimatedNumber(target: number, duration = 900): number {
  const [current, setCurrent] = useState<number>(target || 0);
  const previousRef = useRef<number>(target || 0);

  useEffect(() => {
    const safe = Number.isFinite(target) ? target : 0;
    const start = previousRef.current;
    if (start === safe) return;
    previousRef.current = safe;

    const t0 = performance.now();
    const delta = safe - start;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setCurrent(start + delta * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return current;
}

// ─── Row atoms ──────────────────────────────────────────────────────────────

function TaskRow({ task, index }: { task: OneOffTask; index: number }) {
  const { Icon, title, description, points, done, href } = task;

  const body = (
    <div className="flex items-center gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/[0.06] transition-colors group-hover:border-white/[0.12] group-hover:bg-white/[0.03]">
      <div
        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
          done
            ? "bg-white/10 border-white/20 text-white"
            : "bg-white/[0.04] border-white/[0.08] text-white/60"
        }`}
      >
        <Icon className="w-[18px] h-[18px]" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-white/90 leading-tight truncate">
          {title}
        </p>
        <p className="text-[12px] text-white/40 leading-snug mt-0.5">
          {description}
        </p>
      </div>

      {/* Points + status — fixed-width columns so values and badges align
          across every row regardless of digit count or status type.
          Mobile: stack vertically (coin/points on top, status badge
          below), right-aligned. Desktop (lg+): original single row. */}
      <div className="flex flex-col items-end gap-1.5 lg:flex-row lg:items-center lg:gap-3 shrink-0">
        <span className="inline-flex items-center justify-end gap-1 w-14 text-[13px] font-mono font-semibold text-white/90 tabular-nums">
          <Coins className="w-3.5 h-3.5 text-white/60 shrink-0" />+
          {formatCount(points)}
        </span>
        <span className="flex items-center justify-end w-18">
          {done ? (
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/12 border border-white/25 text-white">
              <Check className="w-3.5 h-3.5" strokeWidth={2.6} />
            </span>
          ) : href ? (
            <span className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-white/70 group-hover:text-white">
              Earn <ChevronRight className="w-3.5 h-3.5" />
            </span>
          ) : (
            <span className="text-[11px] font-medium text-white/30 px-2 py-1 rounded-md bg-white/[0.03] border border-white/[0.06]">
              Pending
            </span>
          )}
        </span>
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.35,
        ease: [0.22, 1, 0.36, 1],
        delay: index * 0.04,
      }}
    >
      {!done && href ? (
        <Link href={href} className="block group">
          {body}
        </Link>
      ) : (
        <div className="group">{body}</div>
      )}
    </motion.div>
  );
}

function EarnRow({ rule, index }: { rule: EarnRule; index: number }) {
  const { Icon, title, description, points } = rule;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.35,
        ease: [0.22, 1, 0.36, 1],
        delay: index * 0.03,
      }}
      className="flex items-center gap-3.5 p-4 rounded-2xl bg-white/[0.02] border border-white/[0.06]"
    >
      <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shrink-0 text-white/55">
        <Icon className="w-[17px] h-[17px]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-white/85 leading-tight">
          {title}
        </p>
        <p className="text-[11.5px] text-white/40 leading-snug mt-0.5">
          {description}
        </p>
      </div>
      <span className="inline-flex items-center gap-1 text-[13px] font-mono font-semibold text-white/90 tabular-nums shrink-0">
        <Coins className="w-3.5 h-3.5 text-white/60" />
        {points}
      </span>
    </motion.div>
  );
}

const SECTION_LABEL =
  "text-[11px] font-mono uppercase tracking-[0.18em] text-white/35";

// ─── Refer & Earn ───────────────────────────────────────────────────────────
//
// Real data — pulls the merchant's referral_code from /api/waitlist/me, the
// same endpoint the user app uses. That route is actor-aware (returns the
// merchants row for a merchant token) and lazily generates a code when the
// column is still NULL, so no new backend work is required. Best-effort: any
// fetch failure leaves the card on its "—" placeholder with actions disabled.

const REFERRAL_LINK_BASE = `${
  process.env.NEXT_PUBLIC_APP_URL || "https://app.blip.money"
}/waitlist?ref=`;

type SharePlatform = {
  key: string;
  label: string;
  Icon: LucideIcon;
  /** Deep-link URL to open in a new tab. Receives the message + invite url. */
  href?: (msg: string, url: string) => string;
  /** Special-case action (clipboard copy, native share). */
  onAction?: (msg: string, url: string) => void | Promise<void>;
};

function ReferAndEarnCard() {
  const merchantId = useMerchantStore((s) => s.merchantId);

  const [code, setCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!merchantId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth("/api/waitlist/me");
        if (!res.ok) return;
        const json = (await res.json()) as {
          success?: boolean;
          data?: { actor?: { referral_code?: string | null } };
        };
        if (cancelled || !json?.success) return;
        setCode(json.data?.actor?.referral_code ?? null);
      } catch {
        // Swallow — the placeholder state stands in.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [merchantId]);

  const hasCode = !!code;
  const referralCode = code ?? "—";
  const referralLink = hasCode
    ? `${REFERRAL_LINK_BASE}${code}`
    : REFERRAL_LINK_BASE;
  const shareMessage = hasCode
    ? `Trade on Blip with my code ${referralCode} and we both earn USDT on your first trade.`
    : "Trade on Blip and earn USDT on your first trade.";

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 1800);
  };

  const handleCopyCode = async () => {
    if (!hasCode) return;
    if (await copyToClipboard(referralCode)) {
      setCopiedCode(true);
      showToast("Referral code copied");
      setTimeout(() => setCopiedCode(false), 1800);
    }
  };

  const handleCopyLink = async () => {
    if (!hasCode) return;
    if (await copyToClipboard(referralLink)) {
      setCopiedLink(true);
      showToast("Invite link copied");
      setTimeout(() => setCopiedLink(false), 1800);
    }
  };

  const SHARE_PLATFORMS: SharePlatform[] = [
    {
      key: "whatsapp",
      label: "WhatsApp",
      Icon: MessageCircle,
      href: (msg, url) =>
        `https://wa.me/?text=${encodeURIComponent(`${msg} ${url}`)}`,
    },
    {
      key: "telegram",
      label: "Telegram",
      Icon: Send,
      href: (msg, url) =>
        `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(msg)}`,
    },
    {
      key: "twitter",
      label: "X (Twitter)",
      Icon: XIcon,
      href: (msg, url) =>
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(msg)}&url=${encodeURIComponent(url)}`,
    },
    {
      key: "instagram",
      label: "Instagram",
      // Instagram has no public share URL — copy the link + tell the user.
      Icon: Instagram,
      onAction: async (_msg, url) => {
        const ok = await copyToClipboard(url);
        showToast(ok ? "Link copied — paste into Instagram" : "Couldn't copy link");
      },
    },
    {
      key: "more",
      label: "More",
      Icon: MoreHorizontal,
      onAction: async (msg, url) => {
        const shareData = { title: "Join me on Blip", text: msg, url };
        if (
          typeof navigator !== "undefined" &&
          typeof (navigator as { share?: unknown }).share === "function"
        ) {
          try {
            await (navigator as unknown as { share: (d: unknown) => Promise<void> }).share(
              shareData,
            );
          } catch (err) {
            // AbortError = user dismissed the sheet — do nothing.
            if ((err as { name?: string })?.name !== "AbortError") {
              if (await copyToClipboard(url)) showToast("Invite link copied");
            }
          }
          return;
        }
        if (await copyToClipboard(url)) showToast("Invite link copied");
      },
    },
  ];

  const handleShareClick = (p: SharePlatform) => {
    if (!hasCode) return;
    if (p.onAction) {
      void p.onAction(shareMessage, referralLink);
      return;
    }
    if (p.href && typeof window !== "undefined") {
      window.open(p.href(shareMessage, referralLink), "_blank", "noopener,noreferrer");
    }
  };

  return (
    <>
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
        className="mt-8 rounded-3xl border border-white/[0.08] bg-white/[0.02] p-6 lg:p-8"
      >
        {/* Code + status + gift motif */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className={SECTION_LABEL}>Your Referral Code</p>
            <div className="mt-2 flex items-center gap-2.5 min-w-0">
              <p className="text-[26px] lg:text-[30px] font-extrabold tracking-[-0.02em] leading-none select-all truncate">
                {referralCode}
              </p>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={handleCopyCode}
                disabled={!hasCode}
                aria-label="Copy referral code"
                className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-white/[0.05] border border-white/10 text-white/80 hover:bg-white/[0.08] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {copiedCode ? (
                  <Check className="w-4 h-4 text-white" strokeWidth={2.6} />
                ) : (
                  <Copy className="w-4 h-4" strokeWidth={2.2} />
                )}
              </motion.button>
            </div>
            <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08]">
              <BadgeCheck className="w-3.5 h-3.5 text-white/70" strokeWidth={2.4} />
              <span className="text-[11px] font-bold text-white/70">
                Valid &amp; Active
              </span>
            </div>
          </div>
          <div
            className="shrink-0 w-14 h-14 lg:w-16 lg:h-16 rounded-2xl flex items-center justify-center border border-white/20"
            style={{
              background:
                "linear-gradient(150deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))",
            }}
          >
            <Gift className="w-7 h-7 lg:w-8 lg:h-8 text-white" strokeWidth={1.8} />
          </div>
        </div>

        {/* Invite link + copy */}
        <div className="mt-5 pt-5 border-t border-white/[0.06]">
          <p className="text-[12px] font-semibold text-white/70 mb-2">
            Your Invite Link
          </p>
          <div className="flex items-stretch gap-2">
            <div className="flex-1 min-w-0 flex items-center px-3.5 py-2.5 rounded-2xl bg-white/[0.03] border border-white/[0.08]">
              <span
                className="block w-full truncate text-[13px] font-medium text-white/60"
                title={referralLink}
              >
                {referralLink}
              </span>
            </div>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={handleCopyLink}
              disabled={!hasCode}
              aria-label={copiedLink ? "Copied" : "Copy invite link"}
              className="shrink-0 flex items-center justify-center gap-1.5 px-4 py-3 rounded-2xl bg-white/10 border border-white/15 text-white hover:bg-white/[0.14] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {copiedLink ? (
                <>
                  <Check className="w-4 h-4" strokeWidth={2.6} />
                  <span className="hidden sm:inline text-[13px] font-bold">
                    Copied
                  </span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" strokeWidth={2.2} />
                  <span className="hidden sm:inline text-[13px] font-bold">
                    Copy Link
                  </span>
                </>
              )}
            </motion.button>
          </div>
        </div>

        {/* Share via */}
        <div className="mt-5">
          <p className={`${SECTION_LABEL} mb-2.5`}>Share Via</p>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {SHARE_PLATFORMS.map((p) => (
              <motion.button
                key={p.key}
                whileTap={{ scale: 0.94 }}
                onClick={() => handleShareClick(p)}
                disabled={!hasCode}
                className="min-w-0 flex flex-col items-center gap-1.5 py-3 px-1 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.03] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="w-8 h-8 rounded-full bg-white/[0.05] border border-white/10 flex items-center justify-center text-white/80">
                  <p.Icon className="w-4 h-4" />
                </span>
                <span className="text-[10px] font-semibold text-white/55 text-center leading-tight truncate w-full px-0.5">
                  {p.label}
                </span>
              </motion.button>
            ))}
          </div>
        </div>
      </motion.section>

      {/* Transient copy/share feedback — fixed so it clears the scroll clip */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-none fixed left-1/2 top-4 z-50 -translate-x-1/2"
          >
            <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-[#161616]/95 border border-white/10 backdrop-blur shadow-xl">
              <Check className="w-3.5 h-3.5 text-white" strokeWidth={2.4} />
              <span className="text-[12px] font-semibold text-white">{toast}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function MerchantRewardsPage() {
  const router = useRouter();
  const merchantId = useMerchantStore((s) => s.merchantId);
  const merchantInfo = useMerchantStore((s) => s.merchantInfo);
  const isLoggedIn = useMerchantStore((s) => s.isLoggedIn);

  // Same auth guard as the settings page — bounce to login if not a merchant.
  useEffect(() => {
    if (!merchantId && !isLoggedIn) {
      router.replace("/market/login");
    }
  }, [merchantId, isLoggedIn, router]);

  const animatedBalance = useAnimatedNumber(REWARDS_DATA.balance);

  const doneCount = GETTING_STARTED.filter((t) => t.done).length;

  return (
    <div className="h-screen bg-background text-white flex flex-col overflow-hidden">
      <MerchantNavbar
        activePage="rewards"
        merchantInfo={merchantInfo}
        mobileTitle="Rewards"
        onBack={() => router.push("/market")}
      />

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-4 lg:px-6 py-6 lg:py-10">
          {/* ── Hero: total Blip Points ── */}
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.02] p-6 lg:p-8"
          >
            {/* Soft white glow behind the coin */}
            <div
              className="pointer-events-none absolute -top-16 -right-10 w-56 h-56 rounded-full opacity-30 blur-3xl"
              style={{
                background:
                  "radial-gradient(circle, rgba(255,255,255,0.25), transparent 70%)",
              }}
            />
            <div className="relative flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className={SECTION_LABEL}>Your Blip Points</p>
                <p className="mt-2 text-[44px] lg:text-[52px] font-extrabold tracking-[-0.03em] leading-none tabular-nums">
                  {formatCount(animatedBalance)}
                </p>
                <div className="mt-4 flex items-center gap-5">
                  <div>
                    <p className="text-[11px] text-white/35 font-medium">
                      Lifetime earned
                    </p>
                    <p className="text-[15px] font-bold text-white/80 tabular-nums">
                      {formatCount(REWARDS_DATA.lifetimeEarned)}
                    </p>
                  </div>
                  <div className="w-px h-8 bg-white/[0.08]" />
                  <div>
                    <p className="text-[11px] text-white/35 font-medium">
                      Locked
                    </p>
                    <p className="text-[15px] font-bold text-white/80 tabular-nums">
                      {formatCount(REWARDS_DATA.locked)}
                    </p>
                  </div>
                </div>
              </div>
              <div
                className="shrink-0 w-14 h-14 lg:w-16 lg:h-16 rounded-2xl flex items-center justify-center border border-white/20"
                style={{
                  background:
                    "linear-gradient(150deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))",
                }}
              >
                <Coins
                  className="w-7 h-7 lg:w-8 lg:h-8 text-white"
                  strokeWidth={1.8}
                />
              </div>
            </div>
          </motion.section>

          {/* ── Refer & Earn (real referral code + invite link) ── */}
          <ReferAndEarnCard />

          {/* ── Getting started (one-off tasks) ── */}
          <section className="mt-8">
            <div className="flex items-center justify-between mb-3 px-1">
              <p className={SECTION_LABEL}>Getting started</p>
              <span className="text-[11px] font-semibold text-white/40 tabular-nums">
                {doneCount} of {GETTING_STARTED.length} done
              </span>
            </div>
            <div className="space-y-2.5">
              {GETTING_STARTED.map((task, i) => (
                <TaskRow key={task.key} task={task} index={i} />
              ))}
            </div>
          </section>

          {/* ── Keep earning (repeatable rules) ── */}
          <section className="mt-8">
            <p className={`${SECTION_LABEL} mb-3 px-1`}>Keep earning</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
              {KEEP_EARNING.map((rule, i) => (
                <EarnRow key={rule.key} rule={rule} index={i} />
              ))}
            </div>
          </section>

          <p className="mt-8 text-center text-[11px] text-white/25 leading-relaxed">
            Points are awarded automatically as you trade. Limits apply per the
            earn schedule.
          </p>
        </div>
      </div>
    </div>
  );
}
