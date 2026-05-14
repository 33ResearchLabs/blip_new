"use client";

/**
 * OrderProgressStepper
 * ────────────────────
 * Three-step consumer-style progress timeline for SELL/QR orders. Replaces
 * raw status badges on the tracking page with a Swiggy/Uber-style sequence:
 *
 *   ●━━━━━━━━○━━━━━━━━○
 *   Looking      Payment       Done
 *   for a        on the
 *   payer        way
 *
 * For terminal failure states (cancelled / expired / disputed) the stepper
 * collapses to a single labelled pill instead — there's no progress to show.
 *
 * Pure presentation. Subscribes to nothing — the parent screen feeds it the
 * latest status from the Pusher-backed `useBackendOrder` hook.
 */

import { motion } from "framer-motion";
import { Check } from "lucide-react";

export interface OrderProgressStepperProps {
  /**
   * Authoritative order status from `useBackendOrder` (post-resolution). Falls
   * back to the raw `orders.status` column if the resolver hasn't run.
   */
  status: string;
}

type StepState = "done" | "active" | "upcoming";

interface Step {
  label: string;
  state: StepState;
}

function deriveSteps(status: string): Step[] {
  switch (status) {
    case "open":
    case "accepted":
    case "escrowed":
      return [
        { label: "Looking for a payer", state: "active" },
        { label: "Payment on the way", state: "upcoming" },
        { label: "Done", state: "upcoming" },
      ];
    case "payment_sent":
      return [
        { label: "Looking for a payer", state: "done" },
        { label: "Payment on the way", state: "active" },
        { label: "Done", state: "upcoming" },
      ];
    case "completed":
      return [
        { label: "Looking for a payer", state: "done" },
        { label: "Payment on the way", state: "done" },
        { label: "Done", state: "done" },
      ];
    default:
      // Terminal failure handled by caller via failed-pill branch below.
      return [];
  }
}

export function OrderProgressStepper({ status }: OrderProgressStepperProps) {
  const lower = String(status || "").toLowerCase();

  // Terminal failure → single pill, no stepper.
  if (lower === "cancelled" || lower === "expired") {
    return (
      <div className="mx-auto inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-300 text-[12px] font-semibold">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
        {lower === "cancelled" ? "Cancelled" : "Timed out"}
      </div>
    );
  }
  if (lower === "disputed") {
    return (
      <div className="mx-auto inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-yellow-500/15 border border-yellow-500/30 text-yellow-300 text-[12px] font-semibold">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
        Under review
      </div>
    );
  }

  const steps = deriveSteps(lower);
  if (steps.length === 0) return null;

  return (
    <div className="w-full">
      <div className="flex items-start justify-between gap-1 px-2">
        {steps.map((step, idx) => {
          const isLast = idx === steps.length - 1;
          return (
            <div key={step.label} className="flex-1 flex flex-col items-center min-w-0">
              <div className="flex items-center w-full">
                {/* Left connector — hidden on first step. Mirror image of right connector. */}
                <div
                  className={`flex-1 h-[2px] ${idx === 0 ? "opacity-0" : ""} ${
                    step.state === "done" || step.state === "active"
                      ? "bg-green-500/60"
                      : "bg-white/15"
                  }`}
                />
                {/* Dot */}
                <StepDot state={step.state} />
                {/* Right connector */}
                <div
                  className={`flex-1 h-[2px] ${isLast ? "opacity-0" : ""} ${
                    step.state === "done" ? "bg-green-500/60" : "bg-white/15"
                  }`}
                />
              </div>
              <p
                className={`mt-2 text-[10px] font-semibold text-center leading-tight ${
                  step.state === "upcoming"
                    ? "text-white/40"
                    : step.state === "active"
                      ? "text-white"
                      : "text-white/70"
                }`}
              >
                {step.label}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepDot({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center shrink-0">
        <Check className="w-3.5 h-3.5 text-black" strokeWidth={3} />
      </div>
    );
  }
  if (state === "active") {
    return (
      <motion.div
        className="w-6 h-6 rounded-full bg-accent border-2 border-accent shrink-0"
        animate={{ scale: [1, 1.18, 1], opacity: [1, 0.85, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      />
    );
  }
  return (
    <div className="w-6 h-6 rounded-full bg-white/10 border-2 border-white/20 shrink-0" />
  );
}
