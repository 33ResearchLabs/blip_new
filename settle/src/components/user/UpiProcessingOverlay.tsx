"use client";

/**
 * UpiProcessingOverlay
 * ────────────────────
 * Full-screen overlay that mirrors the UPI "Processing payment…" feel from
 * the prototype's create.html — but in our dark theme. Shown after PIN
 * verify while the on-chain escrow lock + order POST are in flight.
 *
 * Stages:
 *   - "processing" → spinner + label
 *   - "success"    → green tick (auto-advances to onDone after 700ms)
 *
 * Parent controls the stage. We never auto-flip from processing → success
 * here — that would mask backend errors.
 */

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  stage: "processing" | "success";
  /** Headline. Default: stage-appropriate string. */
  title?: string;
  /** Sub-line under the headline. */
  subtitle?: string;
  /** Fires automatically once `stage === "success"` and the tick has been
   *  on screen long enough to register. */
  onDone?: () => void;
}

export function UpiProcessingOverlay({ open, stage, title, subtitle, onDone }: Props) {
  useEffect(() => {
    if (!open || stage !== "success" || !onDone) return;
    const t = setTimeout(onDone, 900);
    return () => clearTimeout(t);
  }, [open, stage, onDone]);

  const headline =
    title ??
    (stage === "processing" ? "Processing payment…" : "Request created");
  const subline =
    subtitle ??
    (stage === "processing"
      ? "Locking USDT in escrow — don't close this screen"
      : "A merchant will pay your UPI shortly");

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[125] flex flex-col items-center justify-center px-8 text-center"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 50% 30%, rgba(120,119,198,0.18), transparent 60%), #07090F",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <AnimatePresence mode="wait">
            {stage === "processing" ? (
              <motion.div
                key="proc"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92 }}
                className="flex flex-col items-center"
              >
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mb-6"
                  style={{
                    background:
                      "linear-gradient(140deg, rgba(255,255,255,0.10), rgba(255,255,255,0.02))",
                    boxShadow:
                      "inset 0 1px 0 rgba(255,255,255,0.16), 0 12px 36px -16px rgba(0,0,0,0.55)",
                  }}
                >
                  <Loader2 className="w-8 h-8 animate-spin text-accent" />
                </div>
                <p className="text-[22px] font-bold tracking-[-0.02em] text-white">
                  {headline}
                </p>
                <p className="mt-2 text-[12px] text-white/55 max-w-[300px]">{subline}</p>
              </motion.div>
            ) : (
              <motion.div
                key="ok"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92 }}
                transition={{ type: "spring", stiffness: 320, damping: 18 }}
                className="flex flex-col items-center"
              >
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center mb-6"
                  style={{
                    background:
                      "radial-gradient(circle at 50% 30%, rgba(168,247,98,0.95), rgba(34,197,94,0.85))",
                    boxShadow:
                      "0 16px 48px -16px rgba(168,247,98,0.55), inset 0 1px 0 rgba(255,255,255,0.5)",
                  }}
                >
                  <Check className="w-10 h-10 text-black" strokeWidth={3} />
                </div>
                <p className="text-[24px] font-bold tracking-[-0.02em] text-white">
                  {headline}
                </p>
                <p className="mt-2 text-[12px] text-white/55 max-w-[300px]">{subline}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Faint progress dots while processing */}
          {stage === "processing" && (
            <div className="absolute bottom-12 flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-white/40"
                  animate={{ opacity: [0.25, 1, 0.25] }}
                  transition={{
                    duration: 1.2,
                    repeat: Infinity,
                    delay: i * 0.2,
                  }}
                />
              ))}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
