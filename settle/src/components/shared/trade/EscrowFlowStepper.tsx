"use client";

// Horizontal 5-step indicator for the escrow-lock trade flow. Presentational
// only — the caller supplies the role-specific labels and the active index, so
// it carries no backend coupling and renders identically in user + merchant
// scopes (surfaces parameterized via SurfaceTokens; text/border/accent are
// global theme tokens). Styling mirrors the existing OrderDetailScreen step
// circles: completed = filled accent + check, current = filled accent with a
// soft ring, upcoming = muted.

import { Check } from "lucide-react";
import type { SurfaceTokens } from "@/components/shared/limits/types";

interface Props {
  /** Ordered step labels, e.g. ["Accepted", "Lock Escrow", …]. */
  steps: string[];
  /** 0-based index of the active step. */
  currentIndex: number;
  surfaces: SurfaceTokens;
  className?: string;
}

export function EscrowFlowStepper({ steps, currentIndex, surfaces, className = "" }: Props) {
  return (
    <div className={`flex items-start ${className}`}>
      {steps.map((label, i) => {
        const done = i < currentIndex;
        const current = i === currentIndex;
        // Half-connectors flank each circle so the line stays centered on the
        // dot. A segment is "filled" once the flow has reached past it.
        const leftFilled = i > 0 && i <= currentIndex;
        const rightFilled = i < currentIndex;
        return (
          <div key={label} className="flex-1 flex flex-col items-center min-w-0">
            <div className="flex items-center w-full">
              <div
                className={`h-[2px] flex-1 ${i === 0 ? "opacity-0" : leftFilled ? "bg-accent" : "bg-border-medium"}`}
              />
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-semibold shrink-0 ${
                  done || current
                    ? "bg-accent text-accent-text"
                    : `${surfaces.chip} text-text-tertiary`
                } ${current ? "ring-4 ring-accent/20" : ""}`}
              >
                {done ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              <div
                className={`h-[2px] flex-1 ${i === steps.length - 1 ? "opacity-0" : rightFilled ? "bg-accent" : "bg-border-medium"}`}
              />
            </div>
            <span
              className={`mt-1.5 px-0.5 text-[10px] leading-tight text-center ${
                current
                  ? "text-text-primary font-semibold"
                  : done
                    ? "text-text-secondary"
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
