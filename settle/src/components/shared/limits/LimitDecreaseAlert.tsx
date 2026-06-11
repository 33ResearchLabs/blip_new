"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowDown, X, AlertCircle } from "lucide-react";
import { formatCount } from "@/lib/format";
import type { SurfaceTokens } from "./types";

interface Props {
  /** Count of unsuccessful (cancelled/disputed/expired) orders in the last 24h. */
  count: number;
  surfaces: SurfaceTokens;
}

/**
 * Informational only — warns that limits MAY decrease due to unsuccessful
 * transactions. It does not change any limit (the cap math ignores this).
 */
export function LimitDecreaseAlert({ count, surfaces }: Props) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-red-500/20 bg-red-500/[0.07]">
        <div className="w-9 h-9 rounded-full bg-red-500/15 text-red-400 flex items-center justify-center shrink-0">
          <ArrowDown className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-red-400">
            Limit Decrease Alert
          </p>
          <p className="text-[12px] text-text-tertiary leading-snug">
            Your limits may decrease due to unsuccessful transactions.
          </p>
          <p className="text-[11px] text-red-400/80 mt-0.5">
            Reason: {formatCount(count)} unsuccessful transaction
            {count === 1 ? "" : "s"} in the last 24 hours.
          </p>
        </div>
        <button
          onClick={() => setShowDetails(true)}
          className="shrink-0 px-3 py-1.5 rounded-lg border border-red-500/30 text-[12px] font-semibold text-red-400 hover:bg-red-500/10 transition-colors"
        >
          View Details
        </button>
      </div>

      <AnimatePresence>
        {showDetails && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowDetails(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              onClick={(e) => e.stopPropagation()}
              className={`w-full max-w-md rounded-2xl p-6 border border-border-subtle ${surfaces.card}`}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center">
                    <AlertCircle className="w-4 h-4" />
                  </div>
                  <h3 className="text-[15px] font-bold text-text-primary">
                    About limit decreases
                  </h3>
                </div>
                <button
                  onClick={() => setShowDetails(false)}
                  aria-label="Close"
                  className={`p-1.5 rounded-lg text-text-tertiary hover:text-text-primary ${surfaces.hover} transition-colors`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-[13px] text-text-secondary leading-relaxed mb-3">
                We track cancelled, disputed, and expired orders to keep trading
                safe. You have{" "}
                <span className="font-semibold text-text-primary">
                  {formatCount(count)} unsuccessful transaction
                  {count === 1 ? "" : "s"}
                </span>{" "}
                in the last 24 hours.
              </p>
              <p className="text-[13px] text-text-tertiary leading-relaxed mb-4">
                Repeated unsuccessful transactions may slow approval of limit
                increase requests and can lead to reduced limits over time.
                Completing trades successfully restores good standing.
              </p>

              <ul className="space-y-2 mb-5">
                {[
                  "Only accept trades you can complete promptly.",
                  "Avoid cancelling after a merchant has locked escrow.",
                  "Respond to chats and send payment within the timer.",
                ].map((tip) => (
                  <li
                    key={tip}
                    className={`flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border border-border-subtle ${surfaces.inset}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary mt-1.5 shrink-0" />
                    <span className="text-[12px] text-text-secondary">
                      {tip}
                    </span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => setShowDetails(false)}
                className={`w-full px-4 py-3 rounded-xl border border-border-subtle text-[13px] font-medium text-text-secondary ${surfaces.chip} ${surfaces.hover} transition-colors`}
              >
                Got it
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
