"use client";

/**
 * Inline Unlock Wallet modal — same pattern as the existing
 * Send / Swap / Deposit / Export-password sheets so desktop merchants
 * stay on the dashboard instead of routing to /merchant/wallet just to
 * type a password.
 *
 * Calls the passed-in `unlockWallet(password)` (from EmbeddedWalletContext)
 * and surfaces a green-check animation + auto-close on success.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, Lock, Loader2, AlertTriangle, Check } from "lucide-react";

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
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPassword("");
      setError(null);
      setBusy(false);
      setDone(false);
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!unlockWallet || !password) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await unlockWallet(password.trim());
      if (!ok) {
        setError("Wrong password. Try again.");
        setBusy(false);
        return;
      }
      setDone(true);
      onUnlocked?.();
      window.setTimeout(() => onClose(), 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to unlock");
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full md:max-w-sm bg-background border-t md:border border-foreground/[0.08] md:rounded-2xl rounded-t-2xl p-5 pb-28 md:pb-5 space-y-3"
      >
        {done ? (
          <div className="py-6 flex flex-col items-center text-center gap-3">
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
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
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
            <p className="text-[12px] text-foreground/50">
              Enter your wallet password to unlock for this session.
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy && password.length > 0) handleSubmit();
              }}
              placeholder="Wallet password"
              maxLength={100}
              autoFocus
              className="w-full bg-foreground/[0.04] border border-foreground/[0.08] rounded-lg px-3 py-2.5 text-sm text-foreground placeholder-foreground/30 focus:outline-none focus:border-foreground/30"
            />
            {error && (
              <p className="text-[11px] text-rose-400/80 flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3" /> {error}
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={onClose}
                disabled={busy}
                className="flex-1 py-2.5 rounded-lg bg-foreground/[0.05] border border-foreground/[0.08] text-foreground/70 text-[12px] font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={busy || password.length === 0 || !unlockWallet}
                className="flex-1 py-2.5 rounded-lg bg-foreground text-background text-[12px] font-bold disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                {busy ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Unlocking…
                  </>
                ) : (
                  "Unlock"
                )}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
