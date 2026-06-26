"use client";

/**
 * WaitingIndicator
 * ────────────────
 * The "calm waiting" treatment for states where the user has NO action — the
 * ball is in the counterparty's court (matching, merchant securing funds). It
 * sits in the shell's Primary Action slot in place of a button, reassuring the
 * user the app is live and working without implying anything to tap.
 *
 * Deliberately quiet: three softly-pulsing dots + a label. No spinner urgency,
 * no accent colour.
 */

import { motion } from "framer-motion";

export interface WaitingIndicatorProps {
  label: string;
}

export function WaitingIndicator({ label }: WaitingIndicatorProps) {
  return (
    <div className="w-full py-3.5 rounded-2xl bg-surface-active border border-border-subtle flex items-center justify-center gap-2.5">
      <span className="flex items-center gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-text-tertiary"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.2, ease: "easeInOut" }}
          />
        ))}
      </span>
      <span className="text-[14px] font-medium text-text-secondary">{label}</span>
    </div>
  );
}
