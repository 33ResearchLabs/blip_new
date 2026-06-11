"use client";

// User-side Stake USDT screen. Mirrors LimitsScreen's chrome exactly — a stacked
// header (back button on its own line, title below at 26px) + a scrollable body —
// so the user app's Stake and Trading Limits screens look identical. The shared
// StakeUSDTView renders the body only (`hideHeader` + `embedded`); this screen owns
// the header and back navigation. Themed via the user app's `.user-scope` tokens.

import { motion } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { StakeUSDTView } from "@/components/shared/limits/StakeUSDTView";
import { SURFACES } from "@/components/shared/limits/types";
import type { Screen } from "./types";

interface StakeScreenProps {
  setScreen: (s: Screen) => void;
}

export function StakeScreen({ setScreen }: StakeScreenProps) {
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
        <p className="text-[26px] font-extrabold tracking-[-0.03em] text-text-primary leading-none">
          Stake
        </p>
      </header>

      {/* Body */}
      <div className="flex-1 px-5 pb-10 overflow-y-auto scrollbar-hide">
        <StakeUSDTView
          surfaces={SURFACES.user}
          embedded
          hideHeader
          onBack={() => setScreen("profile")}
          onStaked={() => {}}
          onHelp={() => setScreen("support")}
        />
      </div>
    </div>
  );
}
