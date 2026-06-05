"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  ChevronRight,
  Copy,
  Check,
  BadgeCheck,
  Gift,
  Sparkles,
  Coins,
  Wallet,
  UserPlus,
  Users,
  Send,
  Instagram,
  MessageCircle,
  MoreHorizontal,
  CircleCheck,
  type LucideIcon,
} from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
import type { Screen } from "./types";
import { BottomNav } from "./BottomNav";

// Established constants used across the user screens
// (ProfileScreen.tsx, OrdersListScreen.tsx, OrderDetailScreen.tsx).
const CARD = "bg-surface-card border border-border-subtle";
const SECTION_LABEL =
  "text-[10px] font-bold tracking-[0.22em] text-text-tertiary uppercase";

export interface RewardsScreenProps {
  /** Current screen — passed through to the persistent BottomNav. */
  screen: Screen;
  setScreen: (s: Screen) => void;
  /** Width constraint shared with the BottomNav (e.g. "max-w-[440px] mx-auto"). */
  maxW: string;
  /** Unread notification count for the BottomNav inbox badge. */
  notificationCount?: number;
  /** All values are API-driven — defaults shown for the empty/loading state. */
  referralCode?: string;
  /** Number of accounts this user has referred. */
  friendsJoined?: number;
  /** BLIP points credited from referrals only (sum of credited reward_amount). */
  blipEarned?: number;
  /** Total BLIP point balance — referrals + register + tasks. */
  totalBlip?: number;
  isLoading?: boolean;
  /** Called when the user taps "Learn more" on the benefits card. */
  onLearnMore?: () => void;
  /** Base URL for the referral link (e.g. https://app.blip.money/waitlist?ref=).
   *  The code is appended client-side. */
  referralLinkBase?: string;
}

// ─── Local utils ─────────────────────────────────────────────────────────

function formatCount(value: number): string {
  const safe = Number.isFinite(value) ? Math.floor(value) : 0;
  return safe.toLocaleString("en-US");
}

/**
 * useAnimatedNumber — eases a target number from its previous value over
 * `duration`ms. Skips the animation when the target is 0 so the initial
 * empty state renders instantly (no "0 → 0" flicker).
 */
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
      // easeOutCubic
      const eased = 1 - Math.pow(1 - p, 3);
      setCurrent(start + delta * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return current;
}

// X (formerly Twitter) brand mark. Lucide ships the legacy bird as `Twitter`
// but no first-party X glyph, so this inline SVG matches the brand's current
// logo. Accepts the same `className` / `strokeWidth` props as a LucideIcon
// so it can drop into the SharePlatform table without a type widen.
const XIcon: LucideIcon = (({ className, strokeWidth = 2, ...rest }: { className?: string; strokeWidth?: number; [k: string]: any }) => (
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

// ─── Share targets (deep links + share intents) ──────────────────────────

type SharePlatform = {
  key: string;
  label: string;
  Icon: LucideIcon;
  /** Returns the deep-link URL to open. Receives the share message + url. */
  href?: (msg: string, url: string) => string;
  /** Special-case action (e.g. native share, copy to clipboard). */
  onAction?: (msg: string, url: string) => void;
};

// ─── Reusable atoms ──────────────────────────────────────────────────────

interface StatCellProps {
  label: string;
  value: string;
  Icon: LucideIcon;
  /** When true, no right-hand divider (last cell in the row). */
  isLast?: boolean;
}

const StatCell = ({ label, value, Icon, isLast = false }: StatCellProps) => (
  <div
    className={`flex-1 min-w-0 px-3 py-3.5 ${
      isLast ? "" : "border-r border-border-subtle"
    }`}
  >
    <div className="flex items-center gap-2 mb-1.5">
      <Icon className="w-[14px] h-[14px] text-text-tertiary shrink-0" />
      <span
        className="text-[15px] font-bold tracking-[-0.02em] leading-none text-text-primary "
        title={value}
      >
        {value}
      </span>
    </div>
    <p className="text-[11px] font-medium text-center text-text-tertiary leading-tight">
      {label}
    </p>
  </div>
);

interface ShareButtonProps {
  label: string;
  Icon: LucideIcon;
  onClick: () => void;
}

const ShareButton = ({ label, Icon, onClick }: ShareButtonProps) => (
  <motion.button
    whileTap={{ scale: 0.93 }}
    whileHover={{ y: -2 }}
    transition={{ type: "spring", stiffness: 380, damping: 28 }}
    onClick={onClick}
    className={`min-w-0 flex flex-col items-center gap-1 py-2 px-1 rounded-xl ${CARD} hover:bg-surface-hover transition-colors`}
  >
    <span className="w-7 h-7 rounded-full bg-surface-raised border border-border-subtle flex items-center justify-center shrink-0">
      <Icon className="w-3.5 h-3.5 text-text-primary" />
    </span>
    <span className="text-[10px] font-semibold text-text-secondary text-center leading-tight max-w-full w-full px-0.5">
      {label}
    </span>
  </motion.button>
);

// Decorative grid of gift / coin icons used inside the main referral card
// and the tips card. Uses theme tokens only — no images / off-palette colors.
const GiftMotif = () => (
  <div className="md:relative hidden w-[88px] h-[88px] shrink-0">
    <motion.div
      animate={{ y: [0, -3, 0] }}
      transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
      className="absolute inset-0 flex items-center justify-center"
    >
      <div
        className="w-[68px] h-[68px] rounded-[18px] bg-surface-raised border border-border-medium flex items-center justify-center"
        style={{
          boxShadow:
            "0 12px 28px -16px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}
      >
        <Gift className="w-7 h-7 text-text-primary" strokeWidth={1.6} />
      </div>
    </motion.div>
    <Sparkles
      className="absolute top-0 left-1 w-3 h-3 text-text-tertiary"
      strokeWidth={1.8}
    />
    <Sparkles
      className="absolute bottom-1 right-0 w-3.5 h-3.5 text-text-tertiary"
      strokeWidth={1.8}
    />
  </div>
);

const CoinsMotif = () => (
  <div className=" relative hidden lg:block w-[80px] h-[64px] shrink-0">
    <div className="absolute left-0 bottom-0 w-10 h-10 rounded-full bg-surface-raised border border-border-medium flex items-center justify-center">
      <Coins className="w-4 h-4 text-text-secondary" strokeWidth={1.8} />
    </div>
    <div className="absolute left-6 bottom-3 w-12 h-12 rounded-full bg-surface-raised border border-border-medium flex items-center justify-center">
      <Coins className="w-5 h-5 text-text-primary" strokeWidth={1.8} />
    </div>
    <Sparkles
      className="absolute top-0 right-2 w-3 h-3 text-text-tertiary"
      strokeWidth={1.8}
    />
  </div>
);

// ─── Screen ──────────────────────────────────────────────────────────────

export const RewardsScreen = ({
  screen,
  setScreen,
  maxW,
  notificationCount = 0,
  referralCode = "—",
  friendsJoined = 0,
  blipEarned = 0,
  totalBlip = 0,
  isLoading = false,
  onLearnMore,
  referralLinkBase = `${
    process.env.NEXT_PUBLIC_APP_URL || "https://app.blip.money"
  }/waitlist?ref=`,
}: RewardsScreenProps) => {
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const hasCode = referralCode && referralCode !== "—";
  const referralLink = hasCode
    ? `${referralLinkBase}${referralCode}`
    : referralLinkBase;
  const shareMessage = hasCode
    ? `Sign up on Blip with my code ${referralCode} and we both earn USDT on your first trade.`
    : "Sign up on Blip and earn USDT on your first trade.";

  // Animated counters
  const aFriends = useAnimatedNumber(friendsJoined);
  const aBlipEarned = useAnimatedNumber(blipEarned);
  const aTotalBlip = useAnimatedNumber(totalBlip);

  // Toast helper — single-channel, replaces any active toast
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(
      () => setToast((current) => (current === msg ? null : current)),
      1800,
    );
  };

  const handleCopyLink = async () => {
    if (!hasCode) return;
    const ok = await copyToClipboard(referralLink);
    if (ok) {
      setCopied(true);
      showToast("Invite link copied");
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleCopyCode = async () => {
    if (!hasCode) return;
    const ok = await copyToClipboard(referralCode);
    if (ok) {
      setCodeCopied(true);
      showToast("Referral code copied");
      setTimeout(() => setCodeCopied(false), 1800);
    }
  };

  // Build the share platform list. Web Share is reserved for "More" so the
  // explicit platform deep-links remain predictable on desktop, where
  // navigator.share is often absent.
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
      // Instagram has no public share URL — copy + tell the user.
      Icon: Instagram,
      onAction: async (_msg, url) => {
        const ok = await copyToClipboard(url);
        showToast(
          ok ? "Link copied — paste into Instagram" : "Couldn't copy link",
        );
      },
    },
    {
      key: "more",
      label: "More",
      Icon: MoreHorizontal,
      onAction: async (msg, url) => {
        const shareData = { title: "Join me on Blip", text: msg, url };
        try {
          if (
            typeof navigator !== "undefined" &&
            typeof (navigator as any).share === "function"
          ) {
            await (navigator as any).share(shareData);
            return;
          }
        } catch {
          // User cancelled — silent.
        }
        const ok = await copyToClipboard(url);
        if (ok) showToast("Invite link copied");
      },
    },
  ];

  const handleShareClick = (p: SharePlatform) => {
    if (!hasCode) return;
    if (p.onAction) {
      p.onAction(shareMessage, referralLink);
      return;
    }
    if (p.href && typeof window !== "undefined") {
      window.open(
        p.href(shareMessage, referralLink),
        "_blank",
        "noopener,noreferrer",
      );
    }
  };

  return (
    <div className="relative flex flex-col h-dvh overflow-hidden bg-surface-base">
      {/* ── Header — big hero title + subtitle. No back chip: this is a
              tab-style screen with the persistent BottomNav below, matching
              the Notifications screen pattern. ── */}
      <header className="px-5 pt-4 pb-4 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="min-w-0"
          >
            <h2 className="text-[26px] font-extrabold tracking-[-0.03em] leading-none text-text-primary">
              Refer &amp; Earn
            </h2>
            <p className="mt-2 text-[13px] font-medium text-text-secondary">
              Earn more when your friends join and trade on blip.money
            </p>
          </motion.section>
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => setScreen("notifications")}
            aria-label="Notifications"
            className="relative shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-surface-hover border border-border-subtle"
          >
            <Bell className="w-[18px] h-[18px] text-text-secondary" strokeWidth={2} />
            {notificationCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-text-primary border-2 border-surface-base flex items-center justify-center">
                <span className="text-[8px] font-extrabold leading-none text-surface-base">
                  {notificationCount > 9 ? "9+" : notificationCount}
                </span>
              </span>
            )}
          </motion.button>
        </div>
      </header>

      {/* ── Scrollable body ── */}
      <div className="flex-1 px-5 pb-28 overflow-y-auto scrollbar-hide">
        <div className="mx-auto w-full max-w-[440px]">
          {/* ── 1. Main referral card ── */}
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className={`mt-4 mb-6 rounded-[22px] overflow-hidden ${CARD}`}
          >
            {/* Top row — code + status badge on the left, motif on the right */}
            <div className="px-5 pt-5 pb-5 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className={SECTION_LABEL}>Your Referral Code</p>
                <div className="mt-2 flex items-center gap-2 min-w-0">
                  <p className="text-[24px] font-extrabold tracking-[-0.01em] text-text-primary leading-none  select-all">
                    {referralCode}
                  </p>
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    whileHover={{ scale: 1.05 }}
                    onClick={handleCopyCode}
                    disabled={!hasCode}
                    aria-label="Copy referral code"
                    className="shrink-0 w-8 h-8 rounded-[10px] flex items-center justify-center bg-surface-raised border border-border-subtle hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      {codeCopied ? (
                        <motion.span
                          key="copied"
                          initial={{ opacity: 0, scale: 0.7 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.7 }}
                          transition={{ duration: 0.18 }}
                          className="flex"
                        >
                          <Check
                            className="w-[15px] h-[15px] text-text-primary"
                            strokeWidth={2.6}
                          />
                        </motion.span>
                      ) : (
                        <motion.span
                          key="copy"
                          initial={{ opacity: 0, scale: 0.7 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.7 }}
                          transition={{ duration: 0.18 }}
                          className="flex"
                        >
                          <Copy
                            className="w-[15px] h-[15px] text-text-secondary"
                            strokeWidth={2.2}
                          />
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.button>
                </div>
                <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-raised border border-border-subtle">
                  <BadgeCheck
                    className="w-3.5 h-3.5 text-text-secondary"
                    strokeWidth={2.4}
                  />
                  <span className="text-[11px] font-bold text-text-secondary">
                    Valid &amp; Active
                  </span>
                </div>
              </div>
              <GiftMotif />
            </div>

            {/* Divider */}
            <div className="mx-5 h-px bg-border-subtle" />

            {/* Bottom row — invite link + Copy Link */}
            <div className="px-5 pt-4 pb-5">
              <p className="text-[12px] font-semibold text-text-secondary mb-2">
                Your Invite Link
              </p>
              <div className="flex items-stretch gap-2">
                <div
                  className="flex-1 min-w-0 flex items-center px-3.5 py-2.5 rounded-[14px] bg-surface-raised border border-border-subtle"
                >
                  <span
                    className="block w-full truncate text-[13px] font-medium text-text-secondary"
                    title={referralLink}
                  >
                    {referralLink}
                  </span>
                </div>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  whileHover={{ y: -1 }}
                  onClick={handleCopyLink}
                  disabled={!hasCode}
                  aria-label={copied ? 'Copied' : 'Copy invite link'}
                  className="shrink-0 flex items-center justify-center gap-1.5 px-3 sm:px-4 py-3 rounded-[14px] bg-accent text-accent-text border border-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {copied ? (
                      <motion.span
                        key="copied"
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.85 }}
                        transition={{ duration: 0.18 }}
                        className="flex items-center gap-1.5"
                      >
                        <Check size={14} strokeWidth={2.6} />
                        <span className="hidden sm:inline text-[13px] font-bold">Copied</span>
                      </motion.span>
                    ) : (
                      <motion.span
                        key="copy"
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.85 }}
                        transition={{ duration: 0.18 }}
                        className="flex items-center gap-1.5"
                      >
                        <Copy size={14} strokeWidth={2.2} />
                        <span className="hidden sm:inline text-[13px] font-bold">Copy Link</span>
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.button>
              </div>
            </div>
          </motion.section>

          {/* ── 4. Your Stats ── */}
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.4,
              ease: [0.22, 1, 0.36, 1],
              delay: 0.15,
            }}
            className="mb-6"
          >
            <p className={`${SECTION_LABEL} mb-3 px-1`}>Your Stats</p>
            <div className={`flex rounded-[18px] overflow-hidden ${CARD}`}>
              <StatCell
                label="Your Referral"
                value={formatCount(aFriends)}
                Icon={Users}
              />
              <StatCell
                label="BLIP Earned"
                value={formatCount(aBlipEarned)}
                Icon={Coins}
              />
              <StatCell
                label="Total BLIP"
                value={formatCount(aTotalBlip)}
                Icon={Wallet}
                isLast
              />
            </div>
          </motion.section>

          {/* ── 3. Benefits callout ── */}
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
            className={`mb-6 rounded-[18px] p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${CARD}`}
          >
            <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-surface-raised border border-border-subtle flex items-center justify-center shrink-0">
                <UserPlus
                  className="w-5 h-5 text-text-primary"
                  strokeWidth={1.8}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-extrabold text-text-primary tracking-[-0.01em] leading-tight">
                  More friends, more rewards
                </p>
                <p className="mt-1 text-[12px] font-medium text-text-secondary leading-snug">
                  You get 20% of trading fees from your friends. They get 10% off.
                </p>
              </div>
            </div>
            {/* <motion.button
              whileTap={{ scale: 0.96 }}
              whileHover={{ y: -1 }}
              onClick={onLearnMore}
              className="w-full sm:w-auto shrink-0 flex items-center justify-center gap-1 px-3 py-2.5 sm:py-2 rounded-[12px] bg-surface-raised border border-border-subtle text-text-primary hover:bg-surface-hover transition-colors"
            >
              <span className="text-[12px] font-bold">Learn more</span>
              <ChevronRight className="w-3.5 h-3.5 text-text-tertiary" />
            </motion.button> */}
          </motion.section>

          {/* ── 2. Share Via ── */}
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.4,
              ease: [0.22, 1, 0.36, 1],
              delay: 0.05,
            }}
            className="mb-6"
          >
            <p className={`${SECTION_LABEL} mb-3 px-1`}>Share Via</p>
            <div className="space-y-2 ">
              <div className="grid grid-cols-3 gap-2">
                {SHARE_PLATFORMS.slice(0, 3).map((p) => (
                  <ShareButton
                    key={p.key}
                    label={p.label}
                    Icon={p.Icon}
                    onClick={() => handleShareClick(p)}
                  />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {SHARE_PLATFORMS.slice(3).map((p) => (
                  <ShareButton
                    key={p.key}
                    label={p.label}
                    Icon={p.Icon}
                    onClick={() => handleShareClick(p)}
                  />
                ))}
              </div>
            </div>
          </motion.section>

          {/* ── 5. Tips ── */}
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
            className={`mb-2 rounded-[18px] p-5 flex items-center gap-4 ${CARD}`}
          >
            <div className="flex-1 min-w-0">
              <p className={`${SECTION_LABEL} mb-3`}>Tips to Earn More</p>
              <ul className="flex flex-col gap-2">
                {[
                  "Share your code on different platforms",
                  "Invite active traders to earn more",
                  "Rewards are updated in real-time",
                ].map((tip) => (
                  <li key={tip} className="flex items-start gap-2.5">
                    <CircleCheck
                      className="w-[15px] h-[15px] text-text-tertiary shrink-0 mt-px"
                      strokeWidth={2}
                    />
                    <span className="text-[13px] font-medium text-text-secondary leading-snug">
                      {tip}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <CoinsMotif />
          </motion.section>

          {/* ── Loading hint (subtle, non-blocking) ── */}
          {isLoading && (
            <p className="mt-2 text-center text-[11px] font-medium text-text-tertiary">
              Refreshing rewards…
            </p>
          )}
        </div>
      </div>

      {/* ── Toast (transient feedback, top-center, non-blocking) ── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 z-50"
            style={{ top: "calc(env(safe-area-inset-top, 8px) + 14px)" }}
          >
            <div
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full ${CARD}`}
              style={{
                boxShadow:
                  "0 14px 32px -12px rgba(0,0,0,0.45), 0 2px 6px -2px rgba(0,0,0,0.3)",
              }}
            >
              <Check
                className="w-3.5 h-3.5 text-text-primary"
                strokeWidth={2.4}
              />
              <span className="text-[12px] font-semibold text-text-primary">
                {toast}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Persistent bottom navigation (tab-style screen, like Notifications) ── */}
      <BottomNav
        screen={screen}
        setScreen={setScreen}
        maxW={maxW}
        notificationCount={notificationCount}
      />
    </div>
  );
};
