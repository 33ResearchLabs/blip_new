"use client";

// User Rewards — Blip Points overview. The user-side mirror of the merchant
// Rewards page (settle/src/app/market/rewards/page.tsx): a balance hero, a
// "Getting started" one-off task list, and a "Keep earning" rule list.
//
// Differences from the merchant page:
//   • themed with the user app's design tokens (light/dark aware), and
//   • the hero balance is wired to real data via /api/coins/me (the user coin
//     endpoint already works), rather than the merchant page's hardcoded mock.
//
// Task completion states below are display-only placeholders (as on the
// merchant page) — wire to real per-task status when that data is available.
// Distinct from the existing "Refer & Earn" referral screen (RewardsScreen).

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  Coins,
  Sparkles,
  ArrowLeftRight,
  TrendingUp,
  Star,
  Flame,
  ShieldCheck,
  UserPlus,
  Check,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { formatCount } from "@/lib/format";
import type { Screen } from "./types";

const CARD = "bg-surface-card border border-border-subtle";
const SECTION_LABEL =
  "text-[11px] font-bold tracking-[0.16em] uppercase text-text-tertiary";

// X (formerly Twitter) brand mark — Lucide has no first-party X glyph.
const XIcon: LucideIcon = (({
  className,
  ...rest
}: {
  className?: string;
  [k: string]: unknown;
}) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true" {...rest}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817-5.965 6.817H1.68l7.73-8.835L1.254 2.25h6.825l4.713 6.231 5.452-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z" />
  </svg>
)) as unknown as LucideIcon;

interface OneOffTask {
  key: string;
  Icon: LucideIcon;
  title: string;
  description: string;
  points: number;
  done: boolean;
  /** Screen the "Earn" CTA navigates to when the task isn't done yet. */
  screen?: Screen;
}

interface EarnRule {
  key: string;
  Icon: LucideIcon;
  title: string;
  description: string;
  /** Pre-formatted label, e.g. "+5" or "+1 / $50". */
  points: string;
}

// One-off tasks — mirror the merchant page, but navigate via in-app screens.
const GETTING_STARTED: OneOffTask[] = [
  {
    key: "welcome",
    Icon: Sparkles,
    title: "Welcome aboard",
    description: "Granted when you create your Blip account.",
    points: 100,
    done: true,
  },
  {
    key: "x",
    Icon: XIcon,
    title: "Verify your X account",
    description: "Link and verify your X (Twitter) handle.",
    points: 50,
    done: false,
    screen: "limits",
  },
  {
    key: "first_trade",
    Icon: ArrowLeftRight,
    title: "Complete your first trade",
    description: "Finish your first order.",
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
    title: "Refer a friend",
    description: "When your referral makes their first trade.",
    points: "+200",
  },
];

// ─── Number easing for the hero counter ─────────────────────────────────────
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
function TaskRow({
  task,
  index,
  onTap,
}: {
  task: OneOffTask;
  index: number;
  onTap?: () => void;
}) {
  const { Icon, title, description, points, done } = task;
  const actionable = !done && !!onTap;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1], delay: index * 0.04 }}
    >
      <button
        type="button"
        onClick={actionable ? onTap : undefined}
        disabled={!actionable}
        className={`group w-full text-left flex items-center gap-4 p-4 rounded-2xl ${CARD} transition-colors ${
          actionable ? "hover:bg-surface-hover" : "cursor-default"
        }`}
      >
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
            done
              ? "bg-green-500/10 border-green-500/20 text-green-500"
              : "bg-surface-active border-border-subtle text-text-secondary"
          }`}
        >
          <Icon className="w-[18px] h-[18px]" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-text-primary leading-tight truncate">
            {title}
          </p>
          <p className="text-[12px] text-text-tertiary leading-snug mt-0.5">
            {description}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-amber-500 tabular-nums">
            <Coins className="w-3.5 h-3.5" />+{formatCount(points)}
          </span>
          {done ? (
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-500/10 border border-green-500/20 text-green-500">
              <Check className="w-3.5 h-3.5" strokeWidth={2.6} />
            </span>
          ) : actionable ? (
            <span className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-text-secondary group-hover:text-text-primary">
              Earn <ChevronRight className="w-3.5 h-3.5" />
            </span>
          ) : (
            <span className="text-[11px] font-medium text-text-tertiary px-2 py-1 rounded-md bg-surface-active border border-border-subtle">
              Pending
            </span>
          )}
        </div>
      </button>
    </motion.div>
  );
}

function EarnRow({ rule, index }: { rule: EarnRule; index: number }) {
  const { Icon, title, description, points } = rule;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1], delay: index * 0.03 }}
      className={`flex items-center gap-3.5 p-4 rounded-2xl ${CARD}`}
    >
      <div className="w-9 h-9 rounded-lg bg-surface-active border border-border-subtle flex items-center justify-center shrink-0 text-text-secondary">
        <Icon className="w-[17px] h-[17px]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-text-primary leading-tight">{title}</p>
        <p className="text-[11.5px] text-text-tertiary leading-snug mt-0.5">{description}</p>
      </div>
      <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-amber-500 tabular-nums shrink-0">
        <Coins className="w-3.5 h-3.5" />
        {points}
      </span>
    </motion.div>
  );
}

// ─── Screen ─────────────────────────────────────────────────────────────────
interface PointsScreenProps {
  setScreen: (s: Screen) => void;
}

export function PointsScreen({ setScreen }: PointsScreenProps) {
  const [coins, setCoins] = useState<{
    balance: number;
    lifetimeEarned: number;
    locked: number;
  } | null>(null);
  // Real X-verification state — drives the "Verify your X account" task's done
  // status (the other task states are still display-only placeholders).
  const [xVerified, setXVerified] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [coinsRes, xRes] = await Promise.all([
          fetchWithAuth("/api/coins/me").then((r) => (r.ok ? r.json() : null)),
          fetchWithAuth("/api/limits/x-verification").then((r) =>
            r.ok ? r.json() : null,
          ),
        ]);
        if (cancelled) return;
        if (coinsRes?.success && coinsRes.data) {
          setCoins({
            balance: Number(coinsRes.data.balance ?? 0),
            lifetimeEarned: Number(coinsRes.data.lifetimeEarned ?? 0),
            locked: Number(coinsRes.data.locked ?? 0),
          });
        }
        if (xRes?.success) setXVerified(Boolean(xRes.data));
      } catch (err) {
        console.error("Failed to load rewards data:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const animatedBalance = useAnimatedNumber(coins?.balance ?? 0);
  // Apply real completion signals onto the display task list.
  const tasks = GETTING_STARTED.map((t) =>
    t.key === "x" ? { ...t, done: xVerified } : t,
  );
  const doneCount = tasks.filter((t) => t.done).length;

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-surface-base">
      {/* Header */}
      <header className="px-5 pt-4 pb-4 shrink-0">
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={() => setScreen("profile")}
          aria-label="Back"
          className={`w-9 h-9 rounded-[14px] flex items-center justify-center mb-3 ${CARD}`}
        >
          <ChevronLeft className="w-5 h-5 text-text-secondary" />
        </motion.button>
        <p className="text-[26px] font-extrabold tracking-[-0.03em] text-text-primary leading-none">
          Rewards
        </p>
      </header>

      {/* Body */}
      <div className="flex-1 px-5 pb-10 overflow-y-auto scrollbar-hide">
        <div className="w-full">
          {/* ── Hero: total Blip Points ── */}
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className={`relative overflow-hidden rounded-3xl p-6 lg:p-8 ${CARD}`}
          >
            {/* Soft gold glow behind the coin */}
            <div
              className="pointer-events-none absolute -top-16 -right-10 w-56 h-56 rounded-full opacity-30 blur-3xl"
              style={{ background: "radial-gradient(circle, rgba(245,200,80,0.35), transparent 70%)" }}
            />
            <div className="relative flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className={SECTION_LABEL}>Your Blip Points</p>
                <p className="mt-2 text-[44px] lg:text-[52px] font-extrabold tracking-[-0.03em] leading-none tabular-nums text-text-primary">
                  {formatCount(animatedBalance)}
                </p>
                <div className="mt-4 flex items-center gap-5">
                  <div>
                    <p className="text-[11px] text-text-tertiary font-medium">Lifetime earned</p>
                    <p className="text-[15px] font-bold text-text-secondary tabular-nums">
                      {formatCount(coins?.lifetimeEarned ?? 0)}
                    </p>
                  </div>
                  <div className="w-px h-8 bg-border-subtle" />
                  <div>
                    <p className="text-[11px] text-text-tertiary font-medium">Locked</p>
                    <p className="text-[15px] font-bold text-text-secondary tabular-nums">
                      {formatCount(coins?.locked ?? 0)}
                    </p>
                  </div>
                </div>
              </div>
              <div
                className="shrink-0 w-14 h-14 lg:w-16 lg:h-16 rounded-2xl flex items-center justify-center border border-amber-400/20"
                style={{ background: "linear-gradient(150deg, rgba(245,210,110,0.18), rgba(245,160,60,0.10))" }}
              >
                <Coins className="w-7 h-7 lg:w-8 lg:h-8 text-amber-400" strokeWidth={1.8} />
              </div>
            </div>
          </motion.section>

          {/* ── Getting started (one-off tasks) ── */}
          <section className="mt-8">
            <div className="flex items-center justify-between mb-3 px-1">
              <p className={SECTION_LABEL}>Getting started</p>
              <span className="text-[11px] font-semibold text-text-tertiary tabular-nums">
                {doneCount} of {tasks.length} done
              </span>
            </div>
            <div className="space-y-2.5">
              {tasks.map((task, i) => (
                <TaskRow
                  key={task.key}
                  task={task}
                  index={i}
                  onTap={task.screen ? () => setScreen(task.screen!) : undefined}
                />
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

          <p className="mt-8 text-center text-[11px] text-text-tertiary leading-relaxed">
            Points are awarded automatically as you trade. Limits apply per the
            earn schedule.
          </p>
        </div>
      </div>
    </div>
  );
}
