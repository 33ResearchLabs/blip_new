"use client";

import { motion } from "framer-motion";
import { ChevronLeft, TrendingDown, CheckCircle2, XCircle, Clock, ExternalLink } from "lucide-react";
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
        <div className="mx-auto w-full max-w-[440px] space-y-4">

          {/* Status card */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-[20px] p-5 bg-error-dim border border-error/25"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-[14px] bg-error/15 flex items-center justify-center shrink-0">
                <TrendingDown className="w-5 h-5 text-error" strokeWidth={2} />
              </div>
              <div>
                <p className="text-[15px] font-extrabold text-text-primary tracking-[-0.02em]">
                  Reputation is low
                </p>
                <p className="text-[12px] font-medium text-text-secondary mt-0.5">
                  {cancelPct}% cancel rate · {cancelledOrderCount} of {totalOrderCount} orders cancelled
                </p>
              </div>
            </div>
            {/* Progress bar */}
            <div className="h-2 rounded-full bg-surface-active overflow-hidden">
              <div
                className="h-full rounded-full bg-error transition-all"
                style={{ width: `${Math.min(cancelPct, 100)}%` }}
              />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] font-bold text-text-tertiary">0%</span>
              <span className="text-[10px] font-bold text-error">{cancelPct}% cancelled</span>
              <span className="text-[10px] font-bold text-text-tertiary">100%</span>
            </div>
          </motion.div>

          {/* What this means */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
            className={`rounded-[20px] p-5 ${CARD}`}
          >
            <p className="text-[12px] font-bold tracking-[0.1em] uppercase text-text-tertiary mb-3">
              What this means
            </p>
            <p className="text-[14px] font-medium text-text-secondary leading-relaxed">
              Your trade reputation is based on how many of your orders are completed versus cancelled. A high cancellation rate signals unreliable behaviour to merchants — which can limit the offers you see and slow down your ability to start new trades.
            </p>
            <p className="text-[14px] font-medium text-text-secondary leading-relaxed mt-3">
              Blip calculates this as your <span className="font-bold text-text-primary">cancellation rate</span> — the percentage of orders you accepted but did not complete. Only orders cancelled after acceptance count; expired orders where you never engaged do not.
            </p>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
            className={`rounded-[20px] overflow-hidden ${CARD}`}
          >
            <div className="flex items-center gap-3 p-4 border-b border-border-subtle">
              <div className="w-9 h-9 rounded-[12px] bg-success/10 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4 text-success" strokeWidth={2} />
              </div>
              <div className="flex-1">
                <p className="text-[13px] font-bold text-text-primary">Completed trades</p>
                <p className="text-[11.5px] font-medium text-text-tertiary mt-0.5">Orders you saw through to the end</p>
              </div>
              <span className="text-[18px] font-extrabold text-text-primary tracking-[-0.02em]">
                {completedCount}
              </span>
            </div>
            <div className="flex items-center gap-3 p-4">
              <div className="w-9 h-9 rounded-[12px] bg-error/10 flex items-center justify-center shrink-0">
                <XCircle className="w-4 h-4 text-error" strokeWidth={2} />
              </div>
              <div className="flex-1">
                <p className="text-[13px] font-bold text-text-primary">Cancelled trades</p>
                <p className="text-[11.5px] font-medium text-text-tertiary mt-0.5">Orders accepted but not completed</p>
              </div>
              <span className="text-[18px] font-extrabold text-error tracking-[-0.02em]">
                {cancelledOrderCount}
              </span>
            </div>
          </motion.div>

          {/* How to improve */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
            className={`rounded-[20px] p-5 ${CARD}`}
          >
            <p className="text-[12px] font-bold tracking-[0.1em] uppercase text-text-tertiary mb-3">
              How to improve
            </p>
            <div className="space-y-3">
              {[
                { icon: CheckCircle2, text: "Only accept trades you intend to complete — don't accept and then cancel." },
                { icon: Clock, text: "Stay active in the chat during an open order. Most disputes start from silence." },
                { icon: TrendingDown, text: "Avoid starting trades when you don't have the funds or time to finish them." },
                { icon: CheckCircle2, text: "Confirm fiat receipt or mark payment sent promptly — delays push orders toward auto-cancel." },
              ].map(({ icon: Icon, text }, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Icon className="w-4 h-4 text-text-tertiary mt-0.5 shrink-0" strokeWidth={2} />
                  <p className="text-[13.5px] font-medium text-text-secondary leading-snug">{text}</p>
                </div>
              ))}
            </div>
          </motion.div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
            className="space-y-2.5 pb-4"
          >
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => setScreen("trade")}
              className="w-full py-3.5 rounded-[16px] bg-accent text-white text-[14px] font-bold tracking-[-0.01em]"
            >
              Start a trade
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => setScreen("support")}
              className={`w-full flex items-center justify-center gap-1.5 py-3.5 rounded-[16px] text-[14px] font-bold text-text-primary ${CARD}`}
            >
              <ExternalLink className="w-4 h-4 text-text-tertiary" strokeWidth={2} />
              Contact support
            </motion.button>
          </motion.div>

        </div>
      </div>
    </div>
  );
}
