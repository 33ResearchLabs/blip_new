"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  ArrowRight,
  Search,
  Mic,
  MessageCircle,
  Send,
  BookOpen,
  Wallet,
  IndianRupee,
  AlertTriangle,
  TrendingUp,
  Lock,
  ShieldCheck,
  Users,
  Ticket,
  HelpCircle,
  ExternalLink,
  Star,
} from "lucide-react";
import type { Screen } from "./types";

// Established constants used across the user screens.
const CARD = "bg-surface-card border border-border-subtle";
const SECTION_LABEL =
  "text-[10px] font-bold tracking-[0.22em] text-text-tertiary uppercase";

const TELEGRAM_DM_URL = "https://t.me/blipmoney_community";
const TELEGRAM_COMMUNITY_URL = "https://t.me/blipmoney_community";

// Only return to known-safe parents so a transient flow can't be re-entered
// with stale state. Mirrors OrderDetailScreen.tsx.
const SAFE_BACK_SCREENS = new Set<Screen>([
  "home",
  "orders",
  "profile",
  "chats",
  "notifications",
  "rewards",
]);

// ─── Reusable atoms ──────────────────────────────────────────────────────

interface QuickActionProps {
  label: string;
  Icon: React.ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;
  onClick: () => void;
}

/** Tall icon-led card used for the 3 top entry points (Live Chat, Telegram,
 *  Help Center). Mirrors the QuickAction tile pattern used on Home. */
const QuickAction = ({ label, Icon, onClick }: QuickActionProps) => (
  <motion.button
    whileTap={{ scale: 0.96 }}
    whileHover={{ y: -2 }}
    transition={{ type: "spring", stiffness: 380, damping: 28 }}
    onClick={onClick}
    className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-2 py-4 rounded-[18px] ${CARD} hover:bg-surface-hover transition-colors`}
  >
    <span className="w-10 h-10 rounded-full bg-surface-raised border border-border-subtle flex items-center justify-center">
      <Icon className="w-[16px] h-[16px] text-white" strokeWidth={2} />
    </span>
    <span className="text-[13px] font-bold tracking-[-0.005em] text-text-primary">
      {label}
    </span>
  </motion.button>
);

interface IssueCardProps {
  title: string;
  Icon: React.ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;
  onClick: () => void;
}

/** Square issue card — icon on the left, title + inline arrow chevron on
 *  the right. Compact: no min-height, no separate arrow row. CSS Grid
 *  auto-equalises heights per row so the layout still looks tidy. */
const IssueCard = ({ title, Icon, onClick }: IssueCardProps) => (
  <motion.button
    whileTap={{ scale: 0.97 }}
    whileHover={{ y: -2 }}
    transition={{ type: "spring", stiffness: 380, damping: 28 }}
    onClick={onClick}
    className={`text-left rounded-[16px] p-3.5 flex items-center gap-3 ${CARD} hover:bg-surface-hover transition-colors`}
  >
    <span className="w-10 h-10 rounded-full bg-surface-raised border border-border-subtle flex items-center justify-center shrink-0">
      <Icon className="w-[16px] h-[16px] text-white" strokeWidth={2} />
    </span>
    <p className="flex-1 min-w-0 text-[12.5px] font-bold leading-[1.25] tracking-[-0.005em] text-text-primary">
      {title}
    </p>
    <ArrowRight className="w-3.5 h-3.5 text-text-tertiary shrink-0" strokeWidth={2.2} />
  </motion.button>
);

interface ChannelCardProps {
  label: string;
  Icon: React.ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;
  badge?: { label: string; recommended?: boolean };
  onClick: () => void;
}

/** Bottom-section channel card — uses the accent surface so it reads as a
 *  separate group from the muted issue cards above. Arrow lives in its own
 *  bottom-right row (same fix as IssueCard) to avoid overlap with the
 *  badge pill at narrow widths. */
const ChannelCard = ({ label, Icon, badge, onClick }: ChannelCardProps) => (
  <motion.button
    whileTap={{ scale: 0.97 }}
    whileHover={{ y: -2 }}
    transition={{ type: "spring", stiffness: 380, damping: 28 }}
    onClick={onClick}
    className="text-left rounded-[18px] p-4 flex flex-col gap-3 min-h-auto bg-surface-raised border border-border-medium hover:bg-surface-hover transition-colors"
  >
    <div className="flex items-start gap-3">
      <span className="w-10 h-10 rounded-full bg-surface-raised border border-border-subtle flex items-center justify-center shrink-0">
        <Icon className="w-[16px] h-[16px] text-white" strokeWidth={2} />
      </span>
      <div className="flex-1 min-w-0 pt-0.5">
        <p className="text-[13px] font-bold leading-tight tracking-[-0.005em] text-text-primary">
          {label}
        </p>
        {badge && (
          <span className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-card border border-border-subtle">
            {badge.recommended && (
              <Star
                className="w-2.5 h-2.5 text-text-secondary"
                strokeWidth={2.4}
                fill="currentColor"
              />
            )}
            <span className="text-[9.5px] font-bold tracking-[0.04em] text-text-secondary">
              {badge.label}
            </span>
          </span>
        )}
      </div>
    </div>
    {/* <div className="mt-auto flex justify-end">
      <span
        className="w-7 h-7 rounded-full bg-surface-card border border-border-subtle flex items-center justify-center"
        aria-hidden
      >
        <ArrowRight className="w-3.5 h-3.5 text-text-secondary" strokeWidth={2.2} />
      </span>
    </div> */}
  </motion.button>
);

// ─── Static data ─────────────────────────────────────────────────────────

const COMMON_ISSUES = [
  { key: "payment-stuck",   title: "Payment stuck or pending?",    Icon: Wallet         },
  { key: "upi-not-credited", title: "UPI sent but USDT not credited", Icon: IndianRupee  },
  { key: "wrong-amount",     title: "Wrong amount sent to seller",  Icon: AlertTriangle  },
  { key: "tier-upgrade",     title: "Tier upgrade not reflected",   Icon: TrendingUp     },
  { key: "account-locked",   title: "Account locked or suspicious flag", Icon: Lock      },
  { key: "escrow-delayed",   title: "Escrow release delayed?",      Icon: ShieldCheck    },
] as const;

// ─── Screen ──────────────────────────────────────────────────────────────

export interface SupportScreenProps {
  setScreen: (s: Screen) => void;
  previousScreen?: Screen;
}

export const SupportScreen = ({ setScreen, previousScreen }: SupportScreenProps) => {
  const [query, setQuery] = useState("");

  const handleBack = () => {
    const target =
      previousScreen && SAFE_BACK_SCREENS.has(previousScreen)
        ? previousScreen
        : "profile";
    setScreen(target);
  };

  const openTelegramDm = () => {
    if (typeof window === "undefined") return;
    window.open(TELEGRAM_DM_URL, "_blank", "noopener,noreferrer");
  };

  const openTelegramCommunity = () => {
    if (typeof window === "undefined") return;
    window.open(TELEGRAM_COMMUNITY_URL, "_blank", "noopener,noreferrer");
  };

  // Stub: a future "/support/tickets" route would land here. For now defer
  // to Telegram so the affordance is never a dead-end.
  const handleMyTickets = () => openTelegramDm();

  // Filter the issues grid by the search query so the empty state is real
  // (something the user can hit with a typo or unrelated term).
  const filteredIssues = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMON_ISSUES;
    return COMMON_ISSUES.filter((i) => i.title.toLowerCase().includes(q));
  }, [query]);

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-surface-base">
      {/* ── Header — back + title on the left, "My Tickets" pill on the right ── */}
      <header className="px-5 pt-10 pb-3 shrink-0 flex items-center gap-3">
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={handleBack}
          aria-label="Back"
          className="w-9 h-9 rounded-xl flex items-center justify-center -ml-1 bg-surface-raised border border-border-subtle"
        >
          <ChevronLeft className="w-5 h-5 text-text-secondary" />
        </motion.button>
        <h1 className="text-[17px] font-semibold text-text-primary">Support</h1>
        <div className="flex-1" />
        <motion.button
          whileTap={{ scale: 0.95 }}
          whileHover={{ y: -1 }}
          onClick={handleMyTickets}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl ${CARD} hover:bg-surface-hover transition-colors`}
        >
          <Ticket className="w-[15px] h-[15px] text-text-secondary" strokeWidth={2} />
          <span className="text-[12px] font-bold text-text-primary">My Tickets</span>
        </motion.button>
      </header>

      {/* ── Scrollable body ── */}
      <div className="flex-1 px-5 pb-8 overflow-y-auto scrollbar-hide">
        <div className="mx-auto w-full max-w-[440px]">

          {/* ── 1. Hero ── */}
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="pt-4 pb-6"
          >
            <h2 className="text-[40px] font-extrabold tracking-[-0.035em] leading-[1.02] text-text-primary">
              Need help?
            </h2>
            <p className="mt-2 text-[14px] font-medium text-text-secondary">
              You are in the right place.
            </p>
          </motion.section>

          {/* ── 2. Quick actions — 3 tall cards ── */}
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
            className="mb-5"
          >
            <div className="grid grid-cols-2 gap-2.5">
              {/* <QuickAction label="Live Chat"   Icon={MessageCircle} onClick={openTelegramDm} /> */}
              <QuickAction label="Telegram"    Icon={Send}          onClick={openTelegramDm} />
              <QuickAction label="Help Center" Icon={BookOpen}      onClick={openTelegramDm} />
            </div>
          </motion.section>

          {/* ── 3. Search ── */}
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
            className="mb-5"
          >
            <div
              className={`flex items-center gap-3 px-4 py-3.5 rounded-[16px] ${CARD}`}
            >
              <Search className="w-[18px] h-[18px] text-text-tertiary shrink-0" strokeWidth={2} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search issues, payments, disputes..."
                maxLength={100}
                aria-label="Search support topics"
                className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[13.5px] font-medium text-text-primary placeholder:text-text-tertiary"
              />
              <button
                type="button"
                aria-label="Voice search"
                onClick={() => {
                  // Web Speech API integration point — silent no-op for now
                  // so the affordance is visible but doesn't error if the
                  // browser doesn't support it.
                }}
                className="shrink-0 text-text-tertiary hover:text-text-secondary transition-colors"
              >
                <Mic className="w-[17px] h-[17px]" strokeWidth={2} />
              </button>
            </div>
          </motion.section>

          {/* ── 4. Common issues grid — empty state if search has no hits ── */}
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: 0.12 }}
            className="mb-5"
          >
            {filteredIssues.length === 0 ? (
              <div
                className={`rounded-[18px] py-10 px-5 flex flex-col items-center justify-center text-center ${CARD}`}
              >
                <span className="w-12 h-12 rounded-full bg-surface-raised border border-border-subtle flex items-center justify-center mb-3">
                  <Search className="w-[18px] h-[18px] text-text-tertiary" strokeWidth={2} />
                </span>
                <p className="text-[13.5px] font-bold text-text-primary mb-1">
                  No matching issues
                </p>
                <p className="text-[11.5px] font-medium text-text-tertiary mb-4">
                  Couldn&apos;t find anything for &ldquo;{query.trim()}&rdquo;.
                </p>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={openTelegramDm}
                  className="px-4 py-2 rounded-[12px] bg-accent text-accent-text border border-accent text-[12px] font-bold"
                >
                  DM support
                </motion.button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {filteredIssues.map(({ key, title, Icon }) => (
                  <IssueCard
                    key={key}
                    title={title}
                    Icon={Icon}
                    onClick={openTelegramDm}
                  />
                ))}
              </div>
            )}
          </motion.section>

          {/* ── 5. Telegram & Community — clearly separated from the
                  issues grid above by a labelled section header so the
                  cards don't read as "more issues". ── */}
          {/* <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
            className="mt-2 mb-6"
          >
            <div className="flex items-center gap-3 mb-3 px-1">
              <p className={SECTION_LABEL}>Reach us</p>
              <span className="flex-1 h-px bg-border-subtle" />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <ChannelCard
                label="DM @blipmoney"
                Icon={Send}
                badge={{ label: "Recommended", recommended: true }}
                onClick={openTelegramDm}
              />
              <ChannelCard
                label="Community"
                Icon={Users}
                badge={{ label: "Get help together" }}
                onClick={openTelegramCommunity}
              />
            </div>
          </motion.section> */}

          {/* ── 6. Footer — still need help / contact us ── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="flex items-center justify-center gap-3 pt-2"
          >
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-text-tertiary">
              <HelpCircle className="w-[14px] h-[14px]" strokeWidth={2} />
              Still need help?
            </span>
            <span className="w-px h-3 bg-border-medium" />
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={openTelegramDm}
              className="inline-flex items-center gap-1 text-[12px] font-bold text-text-primary hover:text-text-secondary transition-colors"
            >
              Contact us
              <ExternalLink className="w-[12px] h-[12px] text-text-tertiary" strokeWidth={2.2} />
            </motion.button>
          </motion.div>
        </div>
      </div>
    </div>
  );
};
