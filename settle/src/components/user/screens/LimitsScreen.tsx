"use client";

// User-side Trading Limits screen. The page body is the shared TradingLimitsView
// (also used by the merchant Settings → Limits tab) — this screen just provides
// the user app's header/back and wires navigation. Themed via the user app's
// design tokens automatically (the shared view uses semantic classes that
// resolve inside `.user-scope`).

import { motion } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { TradingLimitsView } from "@/components/shared/limits/TradingLimitsView";
import type { Screen } from "./types";

interface LimitsScreenProps {
  setScreen: (s: Screen) => void;
}

export function LimitsScreen({ setScreen }: LimitsScreenProps) {
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
          Trading Limits
        </p>
      </header>

      {/* Body */}
      <div className="flex-1 px-5 pb-10 overflow-y-auto scrollbar-hide">
        <TradingLimitsView
          variant="user"
          onNavigate={(dest) =>
            setScreen(dest === "trade" ? "trade" : "support")
          }
        />
      </div>
    </div>
  );
}
