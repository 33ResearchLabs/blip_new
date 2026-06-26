"use client";

/**
 * CurrentStepHero
 * ───────────────
 * The single most important component on every Active Order screen. It answers,
 * in order and without the user having to hunt:
 *
 *   • Where am I?        → eyebrow + title
 *   • What happened?     → happened
 *   • What do I do now?  → the highlighted "Do this now" block (+ optional task)
 *   • What happens next? → its OWN "Next" section (never buried in a paragraph)
 *
 * The countdown is rendered INSIDE the hero (top-right) so the time pressure is
 * visually tied to the current task, not floating elsewhere on the page.
 *
 * `children` is the task substance for states that have one (e.g. the buyer's
 * "where to pay" account rows) — it sits with the instruction, above all
 * secondary information, satisfying the "task first" rule.
 */

import { motion } from "framer-motion";
import { Clock, ArrowRight } from "lucide-react";
import type { ActiveOrderHero } from "@/lib/orders/resolveActiveOrderView";
import { fmtCountdown } from "@/lib/orders/paymentRows";

export interface HeroCountdown {
  remainingSec: number;
  /** Label above the timer, e.g. "Pay within". */
  label: string;
  /** Flip to the urgent (red) treatment, e.g. under 60s left. */
  urgent?: boolean;
  /**
   * Total window in seconds. When provided, a slim, static fill bar at the
   * hero's bottom edge shows the proportion of time left — a subtle
   * glanceability cue, deliberately NOT a large animated progress bar.
   */
  totalSec?: number;
}

export interface CurrentStepHeroProps {
  hero: ActiveOrderHero;
  countdown?: HeroCountdown | null;
  children?: React.ReactNode;
}

export function CurrentStepHero({ hero, countdown, children }: CurrentStepHeroProps) {
  const showTimeBar = !!countdown?.totalSec && countdown.totalSec > 0;
  const timePct = showTimeBar
    ? Math.min(100, Math.max(0, (Math.max(0, countdown!.remainingSec) / countdown!.totalSec!) * 100))
    : 0;

  return (
    <motion.div
      initial={{ y: 8, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="rounded-2xl border border-border-subtle bg-surface-card p-5 overflow-hidden"
    >
      {/* Where am I + countdown */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
            {hero.eyebrow}
          </p>
          <h2 className="text-[22px] font-bold text-text-primary leading-tight mt-0.5">
            {hero.title}
          </h2>
        </div>
        {countdown && (
          <div
            className={`shrink-0 flex flex-col items-end px-3 py-1.5 rounded-xl ${
              countdown.urgent ? "bg-error/15" : "bg-surface-active"
            }`}
          >
            <span className="text-[10px] text-text-tertiary leading-none mb-1 flex items-center gap-1">
              <Clock className="w-3 h-3" /> {countdown.label}
            </span>
            <span
              className={`text-[16px] font-bold tabular-nums leading-none ${
                countdown.urgent ? "text-error" : "text-text-primary"
              }`}
            >
              {fmtCountdown(Math.max(0, countdown.remainingSec))}
            </span>
          </div>
        )}
      </div>

      {/* What happened */}
      <p className="text-[13px] text-text-secondary leading-snug mt-2.5">{hero.happened}</p>

      {/* What do I do now — emphasised */}
      <div className="mt-3 rounded-xl bg-surface-active border border-border-subtle p-3.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mb-1">
          Do this now
        </p>
        <p className="text-[15px] font-medium text-text-primary leading-snug">{hero.doNow}</p>
      </div>

      {/* Task substance (e.g. account rows) — stays with the instruction. */}
      {children}

      {/* What happens next — its own clearly-separated section. */}
      <div className="mt-3.5 pt-3.5 border-t border-border-subtle flex items-start gap-2.5">
        <div className="w-6 h-6 rounded-full bg-surface-active flex items-center justify-center shrink-0 mt-0.5">
          <ArrowRight className="w-3.5 h-3.5 text-text-secondary" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Next</p>
          <p className="text-[13px] text-text-secondary leading-snug">{hero.next}</p>
          {hero.nextSub && (
            <p className="text-[12px] text-text-tertiary leading-snug mt-0.5">{hero.nextSub}</p>
          )}
        </div>
      </div>

      {/* Subtle time affordance — a thin, static fill flush to the card's
          bottom edge. Shrinks with time; turns red when urgent. No shimmer,
          no pulse — just glanceability. */}
      {showTimeBar && (
        <div className="mt-4 -mx-5 -mb-5 h-1 bg-surface-active" aria-hidden="true">
          <div
            className={`h-full transition-[width] duration-1000 ease-linear ${
              countdown!.urgent ? "bg-error" : "bg-text-tertiary"
            }`}
            style={{ width: `${timePct}%` }}
          />
        </div>
      )}
    </motion.div>
  );
}
