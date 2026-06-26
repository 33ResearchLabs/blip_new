"use client";

/**
 * TradeProgress
 * ─────────────
 * The reusable spine of every Active Order screen. Renders the five NEUTRAL
 * trade-lifecycle milestones (Match → Escrow → Payment → Verification →
 * Completion) with the current step always obvious:
 *
 *   ✓ done      filled, checked
 *   ● active    filled, pulsing
 *   ○ upcoming  hollow ring
 *
 * Deliberately role-agnostic — a buyer and a seller see the same bar. The
 * role-specific responsibility lives in CurrentStepHero, never here. Pure
 * presentation: it takes the milestone labels + the active index and draws.
 */

import { motion } from "framer-motion";
import { Check } from "lucide-react";

export interface TradeProgressProps {
  milestones: readonly string[];
  /** 0-based index of the active milestone. */
  currentIndex: number;
}

export function TradeProgress({ milestones, currentIndex }: TradeProgressProps) {
  const last = milestones.length - 1;

  return (
    <div className="flex items-start" role="list" aria-label="Trade progress">
      {milestones.map((label, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        const reached = done || active;

        return (
          <div
            key={label}
            role="listitem"
            aria-current={active ? "step" : undefined}
            className="flex-1 flex flex-col items-center min-w-0"
          >
            {/* Node row — connectors flank the circle so the line is continuous. */}
            <div className="flex items-center w-full">
              <span
                className={`h-0.5 flex-1 rounded-full ${
                  i === 0 ? "opacity-0" : reached ? "bg-text-primary" : "bg-border-medium"
                }`}
              />
              {done ? (
                <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-text-primary">
                  <Check className="w-3.5 h-3.5 text-surface-base" strokeWidth={3} />
                </span>
              ) : active ? (
                <span className="relative w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-text-primary">
                  <motion.span
                    className="absolute inset-0 rounded-full bg-text-primary"
                    animate={{ opacity: [0.5, 0, 0.5], scale: [1, 1.6, 1] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                  />
                  <span className="relative w-2 h-2 rounded-full bg-surface-base" />
                </span>
              ) : (
                <span className="w-6 h-6 rounded-full border-2 border-border-medium bg-surface-card shrink-0" />
              )}
              <span
                className={`h-0.5 flex-1 rounded-full ${
                  i === last ? "opacity-0" : done ? "bg-text-primary" : "bg-border-medium"
                }`}
              />
            </div>

            {/* Label */}
            <span
              className={`mt-2 text-[10px] leading-tight text-center px-0.5 truncate max-w-full ${
                active
                  ? "text-text-primary font-semibold"
                  : done
                    ? "text-text-secondary font-medium"
                    : "text-text-tertiary"
              }`}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
