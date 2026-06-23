"use client";

/**
 * WaitingTracker
 * ──────────────
 * Shared, theme-tokenised "order tracker" layout — the post-escrow / waiting-
 * for-merchant screen. ONE presentational component reused in three places so
 * the user sees an identical screen whether the order was just created, just
 * escrowed, or reopened later:
 *
 *   • EscrowLockScreen (success state) — Sell order, right after locking escrow
 *   • MatchingScreen                   — Buy order, waiting for a merchant
 *   • OrderTrackingView                — any order, reopened from Activity
 *
 * Pure presentation: every status-specific value (banner copy, active step,
 * countdown, whether the escrow card shows, the bottom action) is computed by
 * the caller and passed in. Colours come exclusively from theme tokens
 * (bg-surface-card / text-text-* / bg-accent / bg-success …) — no hardcoded hex.
 */

import { useState, type ReactNode, type ComponentType } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  Clock,
  HelpCircle,
  ShieldCheck,
  Lock,
  FileText,
  ExternalLink,
  Loader2,
} from "lucide-react";

const CARD = "bg-surface-card border border-border-subtle";

export type Tone = "accent" | "success" | "error" | "warning";

const TONE_CLASSES: Record<Tone, { bg: string; text: string }> = {
  accent: { bg: "bg-border-subtle", text: "text-text-secondary" },
  success: { bg: "bg-success/15", text: "text-success" },
  error: { bg: "bg-error/15", text: "text-error" },
  warning: { bg: "bg-warning/15", text: "text-warning" },
};

interface TimelineStep {
  label: string;
  sub?: string;
}

/** The full 7-step buyer/seller journey — single source of truth. */
export const TIMELINE: TimelineStep[] = [
  { label: "Order created" },
  { label: "Matching merchant", sub: "Searching for the best match" },
  { label: "Merchant accepted" },
  { label: "Buyer pays" },
  { label: "Payment confirmed" },
  { label: "USDT released" },
  { label: "Order completed" },
];

type StepState = "done" | "active" | "upcoming";

export interface TrackerTile {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
}

export interface TrackerBanner {
  title: string;
  sub: string;
  icon: ComponentType<{ className?: string }>;
  tone: Tone;
  live: boolean;
  spin?: boolean;
}

function fmtCountdown(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export interface WaitingTrackerProps {
  /** Header title, e.g. "Sell 5.00 USDT". */
  title: string;
  /** Header sub-line, e.g. "Order #BM-260618-E83D". */
  orderRef: string;
  onBack: () => void;
  onOpenSupport: () => void;

  /** Status banner — caller computes copy/icon/tone from the order status. */
  banner: TrackerBanner;
  /** Inline match/expiry countdown shown top-right of the banner. Null hides. */
  countdown?: { remainingSec: number; totalSec: number } | null;

  /** Escrow-locked card. Null hides it (e.g. a buy order where nothing is locked). */
  escrow?: { sub: string; txHref?: string | null } | null;

  /** Active step into TIMELINE (0–6). Pass TIMELINE.length for an all-done order. */
  activeStepIndex: number;
  /** "Order created" timestamp shown against step 0. */
  createdTime?: string;
  /** Sub-line under the "Order progress" header (defaults to the active step). */
  progressSubtitle?: string;
  /** Whether the timeline starts expanded (the post-escrow design shows it open). */
  defaultTimelineOpen?: boolean;

  tiles: TrackerTile[];
  onOpenOverview: () => void;

  /** Primary bottom action — cancel flow. */
  onCancel?: () => void;
  isCancelling?: boolean;
  cancelLabel?: string;
  /** Shown instead of Cancel when the order can't be cancelled (e.g. completed). */
  secondaryAction?: ReactNode;
}

export function WaitingTracker({
  title,
  orderRef,
  onBack,
  onOpenSupport,
  banner,
  countdown,
  escrow,
  activeStepIndex,
  createdTime,
  progressSubtitle,
  defaultTimelineOpen = true,
  tiles,
  onOpenOverview,
  onCancel,
  isCancelling = false,
  cancelLabel = "Cancel Order",
  secondaryAction,
}: WaitingTrackerProps) {
  const [showTimeline, setShowTimeline] = useState(defaultTimelineOpen);
  const tone = TONE_CLASSES[banner.tone];

  const remainingSec = countdown?.remainingSec ?? 0;
  const isUrgent = !!countdown && remainingSec < 60;

  const activeLabel =
    activeStepIndex >= 0 && activeStepIndex < TIMELINE.length
      ? TIMELINE[activeStepIndex].label
      : banner.title;

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-surface-base">
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        <div className="h-[max(env(safe-area-inset-top),1rem)]" />

        {/* Header */}
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
            <p className="text-[12px] text-text-tertiary truncate">{orderRef}</p>
          </div>
          <button
            onClick={onOpenSupport}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-raised border border-border-subtle"
            aria-label="Help & support"
          >
            <HelpCircle className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        <div className="px-5 pb-10 space-y-4">
          {/* Status banner — countdown stacked under the LIVE pill, top-right. */}
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className={`rounded-2xl p-4 flex items-center gap-3 ${CARD}`}
          >
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 relative ${tone.bg}`}>
              {banner.live && (
                <motion.div
                  className={`absolute inset-0 rounded-2xl border-2 ${tone.text} opacity-30`}
                  animate={{ scale: [1, 1.18, 1], opacity: [0.5, 0, 0.5] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
              )}
              <banner.icon className={`w-6 h-6 ${tone.text} ${banner.spin ? "animate-spin" : ""}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold text-text-primary">{banner.title}</p>
              <p className="text-[13px] text-text-secondary leading-snug">{banner.sub}</p>
            </div>
            {(countdown || banner.live) && (
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                {countdown && (
                  <div
                    className={`flex items-center gap-1 text-[15px] font-bold tabular-nums ${
                      isUrgent ? "text-error" : "text-text-primary"
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    {fmtCountdown(remainingSec)}
                  </div>
                )}
                {banner.live && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success/15">
                    <motion.span
                      className="w-1.5 h-1.5 rounded-full bg-success"
                      animate={{ opacity: [1, 0.3, 1] }}
                      transition={{ duration: 1.4, repeat: Infinity }}
                    />
                    <span className="text-[11px] font-semibold text-success">LIVE</span>
                  </div>
                )}
              </div>
            )}
          </motion.div>

          {/* Escrow-locked card — accent tone, SECURED pill. */}
          {escrow && (
            <motion.div
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.03 }}
              className={`rounded-2xl p-4 flex items-center gap-3 ${CARD}`}
            >
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-border-subtle">
                <ShieldCheck className="w-6 h-6 text-text-secondary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-text-primary">Escrow locked</p>
                <p className="text-[13px] text-text-secondary leading-snug">{escrow.sub}</p>
                {escrow.txHref && (
                  <a
                    href={escrow.txHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-1 text-[12px] font-semibold text-text-secondary"
                  >
                    View transaction <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-border-subtle shrink-0 self-start">
                <Lock className="w-3 h-3 text-text-secondary" />
                <span className="text-[11px] font-semibold text-text-secondary">SECURED</span>
              </div>
            </motion.div>
          )}

          {/* Order progress — collapsible, open by default. */}
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.05 }}
            className={`rounded-2xl overflow-hidden ${CARD}`}
          >
            <button
              type="button"
              onClick={() => setShowTimeline((o) => !o)}
              aria-expanded={showTimeline}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
            >
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-text-primary">Order progress</p>
                <p className="text-[13px] text-text-tertiary truncate">
                  {progressSubtitle || activeLabel}
                </p>
              </div>
              <ChevronDown
                className={`w-5 h-5 text-text-tertiary shrink-0 transition-transform ${
                  showTimeline ? "rotate-180" : ""
                }`}
              />
            </button>
            <AnimatePresence initial={false}>
              {showTimeline && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 pt-1">
                    {TIMELINE.map((step, i) => {
                      const state: StepState =
                        i < activeStepIndex ? "done" : i === activeStepIndex ? "active" : "upcoming";
                      const isLast = i === TIMELINE.length - 1;
                      return (
                        <div key={step.label} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <StepDot state={state} />
                            {!isLast && (
                              <div
                                className={`w-0.5 flex-1 min-h-[18px] ${
                                  state === "done" ? "bg-warning" : "bg-border-medium"
                                }`}
                              />
                            )}
                          </div>
                          <div className={`flex-1 flex items-start justify-between gap-2 ${isLast ? "" : "pb-4"}`}>
                            <div className="min-w-0">
                              <p
                                className={`text-[15px] font-medium ${
                                  state === "upcoming" ? "text-text-tertiary" : "text-text-primary"
                                }`}
                              >
                                {step.label}
                              </p>
                              {step.sub && state === "active" && (
                                <p className="text-[13px] text-text-tertiary leading-snug">{step.sub}</p>
                              )}
                            </div>
                            {i === 0 && createdTime && (
                              <span className="text-[13px] text-text-tertiary shrink-0">{createdTime}</span>
                            )}
                            {state === "active" && i !== 0 && (
                              <span className="text-[13px] font-medium text-warning shrink-0">In progress</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Order Overview row */}
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1 }}
            className={`rounded-2xl overflow-hidden ${CARD}`}
          >
            <button
              onClick={onOpenOverview}
              className="w-full flex items-center gap-3 px-5 py-4 text-left active:bg-surface-hover"
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-border-subtle">
                <FileText className="w-5 h-5 text-text-secondary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium text-text-primary">Order Overview</p>
                <p className="text-[13px] text-text-tertiary">View order details</p>
              </div>
              <ChevronRight className="w-5 h-5 text-text-tertiary shrink-0" />
            </button>
          </motion.div>

          {/* Summary tiles */}
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.15 }}
            className="grid grid-cols-3 gap-2"
          >
            {tiles.map((t) => (
              <SummaryTile key={t.label} icon={t.icon} label={t.label} value={t.value} sub={t.sub} />
            ))}
          </motion.div>

          {/* Bottom action */}
          {onCancel ? (
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={onCancel}
              disabled={isCancelling}
              className="w-full py-4 rounded-2xl text-[16px] font-semibold bg-foreground/[0.05] text-foreground/70 border border-foreground/[0.08] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isCancelling && <Loader2 className="w-4 h-4 animate-spin" />}
              {cancelLabel}
            </motion.button>
          ) : (
            secondaryAction
          )}
        </div>
      </div>
    </div>
  );
}

function StepDot({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <div className="w-6 h-6 rounded-full bg-warning flex items-center justify-center shrink-0">
        <Check className="w-3.5 h-3.5 text-accent-text" strokeWidth={3} />
      </div>
    );
  }
  if (state === "active") {
    return (
      <motion.div
        className="w-6 h-6 rounded-full bg-warning shrink-0"
        animate={{ scale: [1, 1.15, 1], opacity: [1, 0.8, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      />
    );
  }
  return <div className="w-6 h-6 rounded-full border-2 border-border-medium bg-transparent shrink-0" />;
}

function SummaryTile({
  icon,
  label,
  value,
  sub,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className={`rounded-xl p-2.5 text-center ${CARD}`}>
      <div className="flex items-center justify-center text-text-tertiary mb-1">{icon}</div>
      <p className="text-[10px] uppercase tracking-wide text-text-tertiary mb-0.5">{label}</p>
      <p className="text-[13px] font-semibold text-text-primary leading-tight truncate">{value}</p>
      {sub && <p className="text-[10px] text-text-tertiary leading-tight">{sub}</p>}
    </div>
  );
}
