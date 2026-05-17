"use client";

/**
 * Inline Unlock Wallet modal — desktop merchants stay on the dashboard
 * instead of routing to /merchant/wallet just to enter their PIN.
 *
 * Uses the same on-screen 6-digit PIN keypad as the user-side wallet.
 * The PIN is the merchant's sign-in MPIN (same secret across sign-in,
 * wallet setup, and wallet unlock). Auto-unlocks on the 6th digit.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, Lock, Loader2, AlertTriangle, Check } from "lucide-react";
import { AppPinPad } from "@/components/app-lock/AppPinPad";

const PIN_LENGTH = 6;

interface UnlockWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  unlockWallet: ((password: string) => Promise<boolean>) | null;
  /** Optional success hook so the parent can re-probe balances etc. */
  onUnlocked?: () => void;
}

export function UnlockWalletModal({
  isOpen,
  onClose,
  unlockWallet,
  onUnlocked,
}: UnlockWalletModalProps) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorTick, setErrorTick] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPin("");
      setError(null);
      setBusy(false);
      setDone(false);
    }
  }, [isOpen]);

  const handleSubmit = async (value: string) => {
    if (!unlockWallet || !value) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await unlockWallet(value.trim());
      if (!ok) {
        setError("Wrong PIN. Try again.");
        setErrorTick((t) => t + 1);
        setPin("");
        setBusy(false);
        return;
      }
      setDone(true);
      onUnlocked?.();
      window.setTimeout(() => onClose(), 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to unlock");
      setErrorTick((t) => t + 1);
      setPin("");
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-md p-3 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-background border border-foreground/[0.08] rounded-3xl p-6 sm:p-7 space-y-5 flex flex-col shadow-2xl"
        style={{
          minHeight: "min(660px, 88vh)",
          maxHeight: "95vh",
          paddingTop: "max(1.5rem, env(safe-area-inset-top))",
          paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
        }}
      >
        {done ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 320, damping: 18 }}
              className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center"
            >
              <Check className="w-9 h-9 text-emerald-400" strokeWidth={3} />
            </motion.div>
            <p className="text-sm font-bold text-foreground">Wallet unlocked</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Lock className="w-4 h-4 text-primary" />
                Unlock Wallet
              </h3>
              <button
                onClick={onClose}
                className="p-1 rounded-lg text-foreground/40 hover:text-foreground/70"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm font-mono text-center text-foreground/60">
              Enter your 6-digit sign-in PIN.
            </p>

            {error && (
              <p className="text-[12px] text-rose-400 text-center flex items-center justify-center gap-1.5">
                <AlertTriangle className="w-3 h-3" /> {error}
              </p>
            )}

            <div className="flex-1 flex items-center justify-center">
              <div style={{ maxWidth: 320, width: "100%" }}>
                <AppPinPad
                  value={pin}
                  onChange={setPin}
                  onComplete={(v) => handleSubmit(v)}
                  length={PIN_LENGTH}
                  errorTick={errorTick}
                  disabled={busy}
                />
              </div>
            </div>

            {busy && (
              <div className="flex items-center justify-center gap-2 text-foreground/60">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs font-mono">Unlocking…</span>
              </div>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}
