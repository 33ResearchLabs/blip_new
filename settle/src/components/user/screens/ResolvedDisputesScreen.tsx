"use client";

// User-side Resolved Disputes screen. A dedicated page (reached from
// Profile → Disputes → Resolved Disputes) that lists the user's resolved
// dispute history. Mirrors LimitsScreen's header/back pattern and uses the
// user app's semantic design tokens so it themes automatically in light/dark.

import { motion } from "framer-motion";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import type { Screen } from "./types";

interface ResolvedDispute {
  id: string;
  orderNumber: string;
  resolvedInFavorOf: string;
  resolvedAt: string;
  otherPartyName: string;
  cryptoAmount: number;
  reason: string;
}

interface ResolvedDisputesScreenProps {
  setScreen: (s: Screen) => void;
  resolvedDisputes: ResolvedDispute[];
}

const CARD = "bg-surface-card border border-border-subtle";

export function ResolvedDisputesScreen({
  setScreen,
  resolvedDisputes,
}: ResolvedDisputesScreenProps) {
  const hasDisputes = resolvedDisputes.length > 0;

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-surface-base">
      {/* Header */}
      <header className="px-5 pt-4 pb-4 shrink-0">
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={() => setScreen("profile")}
          aria-label="Back"
          className="w-9 h-9 rounded-[14px] flex items-center justify-center mb-3 bg-surface-card border border-border-subtle"
        >
          <ChevronLeft className="w-5 h-5 text-text-secondary" />
        </motion.button>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[26px] font-extrabold tracking-[-0.03em] text-text-primary leading-none">
            Resolved Disputes
          </p>
          {hasDisputes && (
            // Monochrome count — black/white in dark mode; the .user-light CSS
            // flips it to a near-black pill with white text. No accent colour.
            <span className="inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full text-[12px] font-bold tabular-nums bg-white text-black">
              {resolvedDisputes.length}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-[13px] text-text-tertiary">
          Your resolved dispute history
        </p>
      </header>

      {/* Body */}
      <div className="flex-1 px-5 pb-10 overflow-y-auto scrollbar-hide">
        {!hasDisputes ? (
          <div className="mt-24 flex flex-col items-center text-center px-6">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-surface-card border border-border-subtle mb-4">
              <ShieldCheck className="w-7 h-7 text-text-tertiary" />
            </div>
            <p className="text-[15px] font-semibold text-text-primary">
              No resolved disputes yet
            </p>
            <p className="mt-1 text-[13px] text-text-tertiary leading-snug">
              Disputes you&apos;ve had resolved will appear here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {resolvedDisputes.map((dispute) => {
              const won = dispute.resolvedInFavorOf === "user";
              const lost = dispute.resolvedInFavorOf === "merchant";
              const badgeClass = won
                ? "bg-surface-raised text-text-primary border border-border-medium"
                : "bg-surface-active text-text-tertiary border border-border-subtle";
              return (
                <div key={dispute.id} className={`rounded-[16px] px-4 py-3 ${CARD}`}>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[13px] font-bold text-text-primary truncate">
                        #{dispute.orderNumber}
                      </span>
                      <span
                        className={`text-[9px] font-bold tracking-[0.1em] uppercase px-2 py-0.5 rounded-full shrink-0 ${badgeClass}`}
                      >
                        {won ? "Won" : lost ? "Lost" : "Split"}
                      </span>
                    </div>
                    <p className="text-[11px] text-text-tertiary shrink-0">
                      {new Date(dispute.resolvedAt).toLocaleDateString("en-US")}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] text-text-tertiary truncate">
                      vs {dispute.otherPartyName}
                    </p>
                    <p className="text-[14px] font-bold text-text-primary tracking-[-0.01em] shrink-0">
                      ${dispute.cryptoAmount.toLocaleString()}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
