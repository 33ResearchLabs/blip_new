"use client";

import { motion } from "framer-motion";
import { ChevronLeft, ArrowRight } from "lucide-react";
import type { Screen } from "./types";

const CARD = "bg-surface-card border border-border-subtle";

interface ReputationScreenProps {
  setScreen: (s: Screen) => void;
  cancelledOrderCount?: number;
  totalOrderCount?: number;
}

export function ReputationScreen({
  setScreen,
  cancelledOrderCount = 0,
  totalOrderCount = 0,
}: ReputationScreenProps) {
  const cancelRate = totalOrderCount > 0 ? cancelledOrderCount / totalOrderCount : 0;
  const cancelPct = Math.round(cancelRate * 100);
  const completedCount = totalOrderCount - cancelledOrderCount;

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-surface-base">
      {/* Header */}
      <header className="px-5 pt-4 pb-4 shrink-0">
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={() => setScreen("notifications")}
          aria-label="Back"
          className={`w-9 h-9 rounded-[14px] flex items-center justify-center mb-3 ${CARD}`}
        >
          <ChevronLeft className="w-5 h-5 text-text-secondary" />
        </motion.button>
        <p className="text-[26px] font-extrabold tracking-[-0.03em] text-text-primary leading-none">
          Trade Reputation
        </p>
      </header>

      {/* Body */}
      <div className="flex-1 px-5 pb-10 overflow-y-auto scrollbar-hide">
        <div className="space-y-3">

          {/* Cancel rate — big number, no color drama */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className={`rounded-[20px] p-5 ${CARD}`}
          >
            <p className="text-[11px] font-bold tracking-[0.12em] uppercase text-text-tertiary mb-4">
              Cancel rate
            </p>
            <p className="text-[52px] font-extrabold tracking-[-0.04em] text-text-primary leading-none">
              {cancelPct}<span className="text-[28px] text-text-secondary">%</span>
            </p>
            <p className="text-[13px] font-medium text-text-tertiary mt-2">
              {cancelledOrderCount} of {totalOrderCount} orders cancelled
            </p>
            {/* Progress bar */}
            <div className="mt-4 h-1.5 rounded-full bg-border-subtle overflow-hidden">
              <div
                className="h-full rounded-full bg-text-primary transition-all"
                style={{ width: `${Math.min(cancelPct, 100)}%` }}
              />
            </div>
          </motion.div>

          {/* Stats row */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
            className={`rounded-[20px] overflow-hidden ${CARD}`}
          >
            <div className="flex divide-x divide-border-subtle">
              <div className="flex-1 p-4">
                <p className="text-[11px] font-bold tracking-[0.1em] uppercase text-text-tertiary mb-1">Completed</p>
                <p className="text-[28px] font-extrabold tracking-[-0.03em] text-text-primary leading-none">{completedCount}</p>
              </div>
              <div className="flex-1 p-4">
                <p className="text-[11px] font-bold tracking-[0.1em] uppercase text-text-tertiary mb-1">Cancelled</p>
                <p className="text-[28px] font-extrabold tracking-[-0.03em] text-text-primary leading-none">{cancelledOrderCount}</p>
              </div>
            </div>
          </motion.div>

          {/* What this means */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
            className={`rounded-[20px] p-5 ${CARD}`}
          >
            <p className="text-[11px] font-bold tracking-[0.12em] uppercase text-text-tertiary mb-3">
              Why it matters
            </p>
            <p className="text-[14px] font-medium text-text-secondary leading-relaxed">
              A high cancellation rate signals unreliable behaviour to merchants — it can limit the offers you see and slow down your ability to start new trades.
            </p>
            <p className="text-[14px] font-medium text-text-secondary leading-relaxed mt-2.5">
              Only orders cancelled <span className="font-bold text-text-primary">after acceptance</span> count toward this rate. Orders that expired before anyone engaged do not affect your score.
            </p>
          </motion.div>

          {/* How to improve */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
            className={`rounded-[20px] p-5 ${CARD}`}
          >
            <p className="text-[11px] font-bold tracking-[0.12em] uppercase text-text-tertiary mb-3">
              How to improve
            </p>
            <div className="space-y-3.5">
              {[
                "Only accept trades you intend to complete.",
                "Stay active in the chat — most disputes start from silence.",
                "Don't start a trade if you don't have the funds or time to finish.",
                "Mark payment sent or confirm receipt promptly to avoid auto-cancellation.",
              ].map((text, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-surface-active border border-border-subtle flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[9px] font-extrabold text-text-tertiary">{i + 1}</span>
                  </span>
                  <p className="text-[13.5px] font-medium text-text-secondary leading-snug">{text}</p>
                </div>
              ))}
            </div>
          </motion.div>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
            className="space-y-2.5 pb-4"
          >
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => setScreen("trade")}
              className="w-full flex items-center justify-between px-5 py-4 rounded-[16px] bg-text-primary"
            >
              <span className="text-[14px] font-bold text-surface-base">Start a trade</span>
              <ArrowRight className="w-4 h-4 text-surface-base opacity-60" strokeWidth={2.2} />
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => setScreen("support")}
              className={`w-full flex items-center justify-between px-5 py-4 rounded-[16px] ${CARD}`}
            >
              <span className="text-[14px] font-bold text-text-primary">Contact support</span>
              <ArrowRight className="w-4 h-4 text-text-tertiary" strokeWidth={2.2} />
            </motion.button>
          </motion.div>

        </div>
      </div>
    </div>
  );
}
