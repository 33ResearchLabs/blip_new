"use client";

/**
 * PaymentConfirmSheet
 * ───────────────────
 * The "I've Paid" guard. Marking a fiat payment as sent is irreversible — the
 * seller releases the buyer's USDT based on it — so this sheet sits in front of
 * the action and makes the buyer confirm three things before it's enabled:
 * the amount, the destination, and that the payment actually completed.
 *
 * Pure presentation: the actual mark-paid call stays in OrderDetailScreen. This
 * sheet only gates it behind an explicit, checklist-confirmed acknowledgement.
 * Visuals are cloned from CancelOrderSheet so it feels native (portal into the
 * user scope, same scrim + spring + grip + tokens). Colour discipline: accent
 * for the confirm action; everything else is monochrome surface tokens; red is
 * reserved for a genuine failure message.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, AlertTriangle, Check, ShieldCheck } from "lucide-react";

export interface PaymentConfirmSheetProps {
  open: boolean;
  /** e.g. "₹4,925" — restated so the buyer re-reads the figure they sent. */
  amountLabel: string;
  /** e.g. the account name — where the money should have gone. */
  destination: string;
  /** The 3 things the buyer must confirm; confirm enables only when all ticked. */
  checklist: string[];
  /** e.g. "Yes, I've sent ₹4,925". */
  confirmLabel: string;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
  maxW?: string;
}

export function PaymentConfirmSheet({
  open,
  amountLabel,
  destination,
  checklist,
  confirmLabel,
  loading = false,
  error = null,
  onClose,
  onConfirm,
  maxW = "max-w-[440px]",
}: PaymentConfirmSheetProps) {
  const [checked, setChecked] = useState<boolean[]>([]);
  // Reset the ticks each time the sheet opens (adjusting state on a prop change,
  // during render — avoids a set-state-in-effect).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setChecked(checklist.map(() => false));
  }

  if (typeof document === "undefined") return null;
  const host = document.getElementById("user-scope-root") ?? document.body;
  const allChecked = checked.length === checklist.length && checked.every(Boolean);

  return createPortal(
    <AnimatePresence>
      {open && (
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
            className={`fixed bottom-0 left-1/2 -translate-x-1/2 z-[151] w-full ${maxW} rounded-t-3xl flex flex-col border-t border-border-subtle bg-surface-base max-h-[90dvh]`}
          >
            <div className="overflow-y-auto scrollbar-hide pt-2.5 px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
              <div className="mx-auto w-10 h-1 rounded-full mb-4 bg-border-medium" />

              <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-surface-active mb-3">
                <ShieldCheck className="w-6 h-6 text-text-secondary" />
              </div>

              <h2 className="text-[18px] font-bold text-text-primary">Did you send the payment?</h2>
              <p className="text-[14px] text-text-secondary leading-snug mt-1.5">
                You&apos;re confirming you sent{" "}
                <span className="font-semibold text-text-primary">{amountLabel}</span> to{" "}
                <span className="font-semibold text-text-primary">{destination}</span>.
              </p>

              {/* Checklist — confirm stays disabled until every box is ticked. */}
              <div className="mt-4 space-y-2">
                {checklist.map((item, i) => {
                  const on = !!checked[i];
                  return (
                    <button
                      key={item}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      disabled={loading}
                      onClick={() =>
                        setChecked((c) => {
                          const next = checklist.map((_, j) => !!c[j]);
                          next[i] = !next[i];
                          return next;
                        })
                      }
                      className="w-full flex items-center gap-3 rounded-xl p-3 text-left border border-border-subtle bg-surface-card disabled:opacity-60"
                    >
                      <span
                        className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 border ${
                          on ? "bg-accent border-accent" : "border-border-medium"
                        }`}
                      >
                        {on && <Check className="w-3.5 h-3.5 text-accent-text" strokeWidth={3} />}
                      </span>
                      <span className="text-[13.5px] text-text-primary leading-snug">{item}</span>
                    </button>
                  );
                })}
              </div>

              {/* Caution — calm, monochrome (not an error). */}
              <div className="mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 bg-surface-active border border-border-subtle">
                <AlertTriangle className="w-4 h-4 text-text-secondary shrink-0 mt-0.5" />
                <p className="text-[12px] leading-snug text-text-secondary">
                  Only confirm after the money has left your account. The seller releases your
                  USDT based on this — it can&apos;t be undone.
                </p>
              </div>

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
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={onConfirm}
                  disabled={!allChecked || loading}
                  className="w-full h-12 rounded-xl text-[15px] font-bold bg-accent text-accent-text disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? "Confirming…" : confirmLabel}
                </motion.button>
                <button
                  onClick={onClose}
                  disabled={loading}
                  className="w-full h-12 rounded-xl text-[15px] font-semibold bg-surface-active text-text-primary disabled:opacity-50"
                >
                  Not yet
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    host,
  );
}
