"use client";

/**
 * OrderMinimisedPill
 * ──────────────────
 * The collapsed "Hide Details" state for OrderDetailScreen. Renders a single
 * floating pill at the top of the viewport: dot + label + chevron. Tapping
 * expands the order card back. The expanded/minimised toggle is persisted
 * per-order in sessionStorage so a refresh keeps the chosen state.
 *
 * Status copy mirrors OrderProgressStepper so the user sees the same
 * vocabulary in both states.
 */

import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";

interface Props {
  status: string;
  onExpand: () => void;
}

function labelForStatus(status: string): { text: string; tone: "active" | "done" | "warn" | "fail" } {
  const s = String(status || "").toLowerCase();
  if (s === "completed") return { text: "Done", tone: "done" };
  if (s === "cancelled") return { text: "Cancelled", tone: "fail" };
  if (s === "expired") return { text: "Timed out", tone: "fail" };
  if (s === "disputed") return { text: "Under review", tone: "warn" };
  if (s === "payment_sent") return { text: "Payment on the way", tone: "active" };
  if (s === "escrowed" || s === "accepted") return { text: "Waiting for payment", tone: "active" };
  return { text: "Looking for a payer", tone: "active" };
}

export function OrderMinimisedPill({ status, onExpand }: Props) {
  const { text, tone } = labelForStatus(status);
  const dotColor =
    tone === "done"
      ? "bg-success"
      : tone === "fail"
        ? "bg-error"
        : tone === "warn"
          ? "bg-warning"
          : "bg-accent";

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      onClick={onExpand}
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[110] inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-surface-card/95 backdrop-blur-md border border-border-medium shadow-lg active:scale-95 transition-transform"
    >
      <motion.span
        className={`w-1.5 h-1.5 rounded-full ${dotColor}`}
        animate={tone === "active" ? { opacity: [1, 0.4, 1] } : {}}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      />
      <span className="text-[12px] font-semibold text-text-primary">{text}</span>
      <ChevronDown className="w-3.5 h-3.5 text-text-tertiary" />
    </motion.button>
  );
}
