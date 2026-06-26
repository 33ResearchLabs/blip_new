"use client";

/**
 * CancelOrderSheet
 * ────────────────
 * One reusable, content-free confirmation sheet for cancelling an order. It
 * receives a `CancelDialogConfig` (from `resolveCancelDialog`) and renders an
 * identical layout for every stage — only the content changes. No stage logic
 * and no copy live here.
 *
 * Visuals are cloned from PayWithSheet so it feels native: portal into the
 * user scope, same scrim + spring, grip, rounded-top sheet, theme tokens only.
 * Colour discipline: the icon is monochrome (no coloured info cards), the safe
 * action uses the app accent, and red appears ONLY on the destructive button.
 *
 * Button behaviour (consistent across stages):
 *   • primary      → safe action, always closes the sheet (Continue / Keep / Back)
 *   • destructive  → the cancel itself (calls onConfirm); shown for direct/mutual
 *   • secondary    → alternative route for blocked stages (Get help / View appeal)
 */

import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, AlertTriangle } from "lucide-react";
import type { CancelDialogConfig } from "@/lib/orders/resolveCancelDialog";

export interface CancelOrderSheetProps {
  open: boolean;
  config: CancelDialogConfig | null;
  loading?: boolean;
  error?: string | null;
  /** Safe action (primary) + scrim/grip dismissal. */
  onClose: () => void;
  /** Destructive confirm — runs the actual cancel. */
  onConfirm: () => void;
  /** Blocked-stage alternative (help / appeal / chat). */
  onSecondary?: () => void;
  maxW?: string;
}

export function CancelOrderSheet({
  open,
  config,
  loading = false,
  error = null,
  onClose,
  onConfirm,
  onSecondary,
  maxW = "max-w-[440px]",
}: CancelOrderSheetProps) {
  if (typeof document === "undefined") return null;
  const host = document.getElementById("user-scope-root") ?? document.body;
  const Icon = config?.icon;

  return createPortal(
    <AnimatePresence>
      {open && config && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm"
            onClick={loading ? undefined : onClose}
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 320, mass: 0.8 }}
            role="dialog"
            aria-modal="true"
            className={`fixed bottom-0 left-1/2 -translate-x-1/2 z-[151] w-full ${maxW} rounded-t-3xl flex flex-col border-t border-border-subtle bg-surface-base`}
          >
            <div className="pt-2.5 px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
              <div className="mx-auto w-10 h-1 rounded-full mb-4 bg-border-medium" />

              {Icon && (
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-surface-active mb-3">
                  <Icon className="w-6 h-6 text-text-secondary" />
                </div>
              )}

              <h2 className="text-[18px] font-bold text-text-primary">{config.title}</h2>
              <p className="text-[14px] text-text-secondary leading-snug mt-1.5">
                {config.description}
              </p>
              {config.note && (
                <p className="text-[13px] text-text-tertiary leading-snug mt-2">{config.note}</p>
              )}

              {error && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 bg-error-dim border border-error-border"
                >
                  <AlertTriangle className="w-4 h-4 text-error shrink-0 mt-0.5" />
                  <p className="text-[12.5px] leading-snug text-error">{error}</p>
                </div>
              )}

              <div className="mt-5 flex flex-col gap-2.5">
                {/* Primary = safe action. Big, accent, top — never destructive. */}
                <button
                  onClick={onClose}
                  disabled={loading}
                  className="w-full h-12 rounded-xl text-[15px] font-bold bg-accent text-accent-text disabled:opacity-40"
                >
                  {config.primary.label}
                </button>

                {/* Destructive = the cancel itself. Red lives only here. */}
                {config.destructive && (
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={onConfirm}
                    disabled={loading}
                    className="w-full h-12 rounded-xl text-[15px] font-semibold border border-error-border text-error disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                    {loading ? "Cancelling…" : config.destructive.label}
                  </motion.button>
                )}

                {/* Secondary = blocked-stage alternative (neutral, not destructive). */}
                {config.secondary && (
                  <button
                    onClick={onSecondary}
                    disabled={loading}
                    className="w-full h-12 rounded-xl text-[15px] font-semibold bg-surface-active text-text-primary disabled:opacity-50"
                  >
                    {config.secondary.label}
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    host,
  );
}
