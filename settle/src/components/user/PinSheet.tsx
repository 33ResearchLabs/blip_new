"use client";

/**
 * PinSheet
 * ────────
 * Reusable bottom-sheet that asks the user for their 4-6 digit app PIN.
 * Two modes:
 *   - `mode="verify"` — POST /api/user/pin/verify. Fires onSuccess on match.
 *   - `mode="setup"`  — Two-step entry (Enter / Re-enter). POST /api/user/pin
 *                       once they match. Fires onSuccess after save.
 *
 * No on-screen number, just dots that fill — mirrors UPI app convention.
 * Numeric keypad below; physical keyboard digits also accepted.
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Delete, Loader2, AlertCircle } from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

type Mode = "verify" | "setup";

interface Props {
  open: boolean;
  mode: Mode;
  /** Headline shown above the dots. Defaults to a sensible string for the mode. */
  title?: string;
  /** Sub-headline (e.g. "Pay ₹500 to merchant@upi"). */
  subtitle?: string;
  onClose: () => void;
  /** Resolves once verification (or setup) has succeeded server-side.
   *  Receives the cleartext PIN so the caller can derive secondary
   *  secrets (e.g. unlock the embedded wallet using the same PIN). */
  onSuccess: (pin: string) => void;
}

const PIN_LEN_MIN = 4;
const PIN_LEN_MAX = 6;

export function PinSheet({ open, mode, title, subtitle, onClose, onSuccess }: Props) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  // Reset state every time the sheet opens.
  useEffect(() => {
    if (open) {
      setPin("");
      setConfirmPin("");
      setStep("enter");
      setError("");
      setBusy(false);
    }
  }, [open]);

  // Allow physical keyboard input.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (busy) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        push(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        pop();
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pin, confirmPin, step, busy]);

  const activePin = step === "enter" ? pin : confirmPin;
  const setActive = step === "enter" ? setPin : setConfirmPin;

  const push = (d: string) => {
    if (busy) return;
    if (activePin.length >= PIN_LEN_MAX) return;
    setActive(activePin + d);
    setError("");
  };
  const pop = () => {
    if (busy) return;
    setActive(activePin.slice(0, -1));
    setError("");
  };

  // Auto-submit only at MAX length. For shorter PINs (4 or 5 digits) the
  // user must tap the explicit "Continue" button below — we cannot read
  // their mind about whether they've finished typing. Previous behaviour
  // auto-submitted verify at MIN (4), which truncated 6-digit PINs to 4
  // digits and produced false "Incorrect PIN" errors on every tap.
  useEffect(() => {
    if (busy || !open) return;
    if (mode === "verify" && pin.length === PIN_LEN_MAX) {
      void submitVerify();
    } else if (mode === "setup") {
      if (step === "enter" && pin.length === PIN_LEN_MAX) {
        setStep("confirm");
      }
      if (step === "confirm" && confirmPin.length === pin.length) {
        void submitSetup();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, confirmPin, step, busy, open, mode]);

  // Manual commit handler for users with 4- or 5-digit PINs (or to advance
  // the setup "enter" step early). Disabled below MIN and at MAX (the
  // auto-submit covers MAX).
  const canCommit =
    !busy &&
    activePin.length >= PIN_LEN_MIN &&
    activePin.length < PIN_LEN_MAX;
  const onCommit = () => {
    if (!canCommit) return;
    if (mode === "verify") {
      void submitVerify();
    } else if (mode === "setup") {
      if (step === "enter") setStep("confirm");
      else if (step === "confirm" && confirmPin.length === pin.length) {
        void submitSetup();
      }
    }
  };

  const submitVerify = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetchWithAuth("/api/user/pin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        onSuccess(pin);
        return;
      }
      setError(data?.error || "Incorrect PIN");
      setPin("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setPin("");
    }
    setBusy(false);
  };

  const submitSetup = async () => {
    if (pin !== confirmPin) {
      setError("PINs don't match. Try again.");
      setConfirmPin("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetchWithAuth("/api/user/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        onSuccess(pin);
        return;
      }
      setError(data?.error || "Failed to set PIN");
      setStep("enter");
      setPin("");
      setConfirmPin("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    }
    setBusy(false);
  };

  const heading =
    title ??
    (mode === "verify"
      ? "Enter your PIN"
      : step === "enter"
      ? "Create a PIN"
      : "Re-enter to confirm");

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[130] bg-black/70"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            // Full-width sheet surface on phone (unchanged). On tablet (md:) cap
            // + centre it via auto-margins — left:0/right:0 + mx-auto centres a
            // fixed element WITHOUT a transform, so it never fights framer's
            // y-slide. Keeps every phone width byte-for-byte identical and stops
            // the sheet stretching edge-to-edge across a wide screen.
            className="fixed inset-x-0 bottom-0 z-[131] md:max-w-[680px] md:mx-auto bg-surface-base text-text-primary rounded-t-3xl border-t border-border-medium shadow-2xl"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            <div className="mx-auto max-w-[420px] md:max-w-[640px] px-5 py-5 pb-[max(env(safe-area-inset-bottom,16px),16px)]">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold tracking-[0.3em] uppercase text-text-tertiary">
                  {mode === "verify" ? "PIN required" : "Set app PIN"}
                </p>
                <button onClick={onClose} className="p-1.5 rounded-full hover:bg-surface-hover">
                  <X className="w-4 h-4 text-text-tertiary" />
                </button>
              </div>

              <p className="mt-3 text-[20px] font-bold tracking-[-0.02em]">{heading}</p>
              {subtitle && (
                <p className="mt-1 text-[12px] text-text-tertiary">{subtitle}</p>
              )}

              {/* Dots */}
              <div className="mt-6 flex items-center justify-center gap-3">
                {Array.from({ length: PIN_LEN_MAX }).map((_, i) => {
                  const filled = i < activePin.length;
                  return (
                    <div
                      key={i}
                      className="rounded-full transition-all"
                      style={{
                        width: 14,
                        height: 14,
                        background: filled
                          ? "var(--accent, #a8f762)"
                          : "transparent",
                        border: filled
                          ? "2px solid var(--accent, #a8f762)"
                          : "2px solid var(--color-border-strong)",
                      }}
                    />
                  );
                })}
              </div>

              {error && (
                <div className="mt-4 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] bg-error-dim border border-error-border text-error w-full">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              {busy && (
                <div className="mt-4 inline-flex items-center gap-2 text-[12px] text-text-tertiary">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Verifying…
                </div>
              )}

              {/* Keypad */}
              <div className="mt-6 grid grid-cols-3 gap-2">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                  <button
                    key={d}
                    onClick={() => push(d)}
                    disabled={busy}
                    className="py-4 rounded-2xl bg-surface-card hover:bg-surface-hover border border-border-subtle text-[22px] font-semibold disabled:opacity-50"
                  >
                    {d}
                  </button>
                ))}
                <div />
                <button
                  onClick={() => push("0")}
                  disabled={busy}
                  className="py-4 rounded-2xl bg-surface-card hover:bg-surface-hover border border-border-subtle text-[22px] font-semibold disabled:opacity-50"
                >
                  0
                </button>
                <button
                  onClick={pop}
                  disabled={busy}
                  className="py-4 rounded-2xl bg-surface-card hover:bg-surface-hover border border-border-subtle inline-flex items-center justify-center disabled:opacity-50"
                  aria-label="Delete"
                >
                  <Delete className="w-5 h-5" />
                </button>
              </div>

              {/* Continue button — appears once user has typed ≥ MIN but
                  < MAX. At MAX the input auto-submits, so the button is
                  hidden to avoid a redundant tap. Below MIN the button is
                  disabled rather than hidden so the user can see it
                  becoming available as they type. */}
              {activePin.length >= PIN_LEN_MIN && activePin.length < PIN_LEN_MAX && (
                <button
                  onClick={onCommit}
                  disabled={!canCommit}
                  className="mt-3 w-full py-3 rounded-xl text-[14px] font-semibold bg-accent text-accent-text disabled:opacity-50"
                >
                  Continue
                </button>
              )}

              <p className="mt-3 text-[10px] text-text-tertiary text-center">
                {mode === "verify"
                  ? "Required for every Payment."
                  : `${PIN_LEN_MIN}-${PIN_LEN_MAX} digits. Avoid obvious patterns.`}
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
