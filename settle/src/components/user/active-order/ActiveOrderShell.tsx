"use client";

/**
 * ActiveOrderShell
 * ────────────────
 * The fixed scaffold every Active Order state renders into. It guarantees ONE
 * consistent information hierarchy across the whole trade — only the content of
 * each slot changes between states, never the order of the sections:
 *
 *   1. Header
 *   2. Trade Progress        (always)
 *   3. Current Step Hero     (always — the immediate task)
 *   4. Primary Action        (the user's single next action, when there is one)
 *   5. Merchant Information   (who you're trading with — above Help by design)
 *   6. Payment Summary        (when applicable)
 *   7. Escrow Protection      (only when it adds value)
 *   8. Help & Appeal
 *   9. Order Details          (collapsed — advanced / on-chain proof)
 *
 * The shell owns the section ORDER. Each slot is an optional ReactNode, so a
 * state that has no primary action (a "waiting" state) simply omits it and the
 * layout stays correct. This is what makes the experience reusable: states
 * compose the same shell instead of inventing their own layouts.
 */

import { ChevronLeft, HelpCircle } from "lucide-react";
import { TradeProgress } from "./TradeProgress";

export interface ActiveOrderShellProps {
  // Header
  title: string;
  subtitle?: string;
  onBack: () => void;
  onInfo?: () => void;

  // Progress
  milestones: readonly string[];
  currentIndex: number;
  /**
   * When provided, this node renders IN PLACE of the 5-step progress bar.
   * Used only by states that sit off the normal lifecycle (e.g. Under Review),
   * where a "paused / under review" banner is clearer than a frozen stepper.
   * Additive + backward-compatible: omit it and the normal progress renders.
   */
  progressReplacement?: React.ReactNode;

  // Sections (rendered in this fixed order; omit any that don't apply)
  hero: React.ReactNode;
  primaryAction?: React.ReactNode;
  merchant?: React.ReactNode;
  paymentSummary?: React.ReactNode;
  escrowProtection?: React.ReactNode;
  help?: React.ReactNode;
  details?: React.ReactNode;

  /** Anything that must escape the normal flow (e.g. confirm sheets, banners). */
  overlays?: React.ReactNode;
  /** Banner pinned above the hero, e.g. an active-appeal notice. */
  banner?: React.ReactNode;
}

export function ActiveOrderShell({
  title,
  subtitle,
  onBack,
  onInfo,
  milestones,
  currentIndex,
  hero,
  primaryAction,
  merchant,
  paymentSummary,
  escrowProtection,
  help,
  details,
  overlays,
  banner,
}: ActiveOrderShellProps) {
  return (
    <div className="bg-surface-base flex-1 min-h-0 overflow-y-auto scrollbar-hide">
      <div className="h-[max(env(safe-area-inset-top),1rem)]" />

      {/* 1. Header */}
      <div className="px-5 py-4 flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-raised border border-border-subtle"
          aria-label="Back"
        >
          <ChevronLeft className="w-5 h-5 text-text-secondary" />
        </button>
        <div className="text-center flex-1 min-w-0">
          <h1 className="text-[17px] font-semibold text-text-primary truncate">{title}</h1>
          {subtitle && <p className="text-[12px] text-text-tertiary truncate">{subtitle}</p>}
        </div>
        {onInfo ? (
          <button
            onClick={onInfo}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-raised border border-border-subtle"
            aria-label="Order info"
          >
            <HelpCircle className="w-5 h-5 text-text-secondary" />
          </button>
        ) : (
          <div className="w-9 h-9 shrink-0" />
        )}
      </div>

      <div className="px-5 pb-10 space-y-4">
        {banner}

        {/* 2. Trade Progress — always visible. */}
        <div className="rounded-2xl border border-border-subtle bg-surface-card px-4 py-4">
          <TradeProgress milestones={milestones} currentIndex={currentIndex} />
        </div>

        {/* 3. Current Step Hero — the immediate task. */}
        {hero}

        {/* 4. Primary Action. */}
        {primaryAction}

        {/* 5. Merchant Information. */}
        {merchant}

        {/* 6. Payment Summary. */}
        {paymentSummary}

        {/* 7. Escrow Protection. */}
        {escrowProtection}

        {/* 8. Help & Appeal. */}
        {help}

        {/* 9. Order Details (collapsed). */}
        {details}
      </div>

      {overlays}
    </div>
  );
}
