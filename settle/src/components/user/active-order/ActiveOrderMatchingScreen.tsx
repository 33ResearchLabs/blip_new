"use client";

/**
 * ActiveOrderMatchingScreen
 * ─────────────────────────
 * PHASE 2 — the BUY "Finding you a merchant" (matching) state on the new
 * foundation (ActiveOrderShell + 5-step TradeProgress + CurrentStepHero).
 *
 * Pure presentation. It is rendered by MatchingScreen for the BUY case in place
 * of the old WaitingTracker; MatchingScreen keeps ALL behaviour (cancel +
 * idempotency, matched celebration, realtime, order overview). This component
 * only draws the new layout from data + callbacks.
 *
 * Matching is a WAITING state: no primary button — a calm WaitingIndicator sits
 * where the action would be (per the agreed pattern). Cancel is a secondary
 * exit, grouped with Help.
 */

import { ChevronRight, HelpCircle, X } from "lucide-react";
import type { ActiveOrderView } from "@/lib/orders/resolveActiveOrderView";
import { ActiveOrderShell } from "./ActiveOrderShell";
import { CurrentStepHero } from "./CurrentStepHero";
import { WaitingIndicator } from "./WaitingIndicator";
import { SummaryTile } from "./SummaryTile";

const CARD = "bg-surface-card border border-border-subtle";

export interface MatchingTile {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}

export interface ActiveOrderMatchingScreenProps {
  title: string;
  orderRef: string;
  view: ActiveOrderView;
  countdown: { remainingSec: number; totalSec: number };
  tiles: MatchingTile[];
  onBack: () => void;
  onOpenOverview: () => void;
  onOpenSupport: () => void;
  onCancel: () => void;
}

export function ActiveOrderMatchingScreen({
  title,
  orderRef,
  view,
  countdown,
  tiles,
  onBack,
  onOpenOverview,
  onOpenSupport,
  onCancel,
}: ActiveOrderMatchingScreenProps) {
  const isUrgent = countdown.remainingSec < 60;

  return (
    <ActiveOrderShell
      title={title}
      subtitle={orderRef}
      onBack={onBack}
      onInfo={onOpenOverview}
      milestones={view.milestones}
      currentIndex={view.currentIndex}
      hero={
        <CurrentStepHero
          hero={view.hero}
          countdown={{
            remainingSec: countdown.remainingSec,
            label: "Time left",
            urgent: isUrgent,
            totalSec: countdown.totalSec,
          }}
        />
      }
      // Waiting state — calm indicator, no button.
      primaryAction={view.waitingLabel ? <WaitingIndicator label={view.waitingLabel} /> : undefined}
      // No merchant yet during matching.
      paymentSummary={
        <div className="grid grid-cols-3 gap-2">
          {tiles.map((t) => (
            <SummaryTile key={t.label} icon={t.icon} label={t.label} value={t.value} sub={t.sub} />
          ))}
        </div>
      }
      help={
        <div className="space-y-2">
          <button
            onClick={onOpenOverview}
            className={`w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl text-left active:bg-surface-hover ${CARD}`}
          >
            <span className="text-[14px] font-medium text-text-primary">Order overview</span>
            <ChevronRight className="w-4 h-4 text-text-tertiary" />
          </button>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 py-3 rounded-2xl text-[14px] font-semibold text-text-secondary border border-border-medium hover:bg-surface-hover transition-colors flex items-center justify-center gap-2"
            >
              <X className="w-4 h-4" />
              Cancel order
            </button>
            <button
              onClick={onOpenSupport}
              className="flex-1 py-3 rounded-2xl text-[14px] font-medium text-text-secondary hover:bg-surface-hover transition-colors flex items-center justify-center gap-2"
            >
              <HelpCircle className="w-4 h-4" />
              Need help
            </button>
          </div>
        </div>
      }
    />
  );
}
