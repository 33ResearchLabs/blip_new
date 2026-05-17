"use client";

/**
 * Inline Unlock Wallet modal for the merchant dashboard.
 *
 * Tries the 6-digit PIN keypad first. For merchants whose wallet was
 * created under a legacy long password, a "Use password" link swaps in
 * a free-form input; after a successful password unlock, the modal
 * prompts the merchant to choose a new 6-digit PIN and re-encrypts the
 * blob via `onMigrateToPin`. From the next unlock onwards only the PIN
 * is needed.
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Lock, Loader2, AlertTriangle, Check, Key } from "lucide-react";
import { AppPinPad } from "@/components/app-lock/AppPinPad";

const PIN_LENGTH = 6;

type Mode = "pin" | "password" | "setPinEnter" | "setPinConfirm";

interface UnlockWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  unlockWallet: ((password: string) => Promise<boolean>) | null;
  /** Optional. When provided, surfaces a one-time legacy-password →
   *  PIN migration path on the unlock screen. */
  onMigrateToPin?: (oldPassword: string, newPin: string) => Promise<boolean>;
  /** Optional success hook so the parent can re-probe balances etc. */
  onUnlocked?: () => void;
}

export function UnlockWalletModal({
  isOpen,
  onClose,
  unlockWallet,
  onMigrateToPin,
  onUnlocked,
}: UnlockWalletModalProps) {
  const [mode, setMode] = useState<Mode>("pin");
  const [pin, setPin] = useState("");
  const [legacyPassword, setLegacyPassword] = useState("");
  const [verifiedOldPassword, setVerifiedOldPassword] = useState("");
  const [newPin, setNewPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorTick, setErrorTick] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMode("pin");
      setPin("");
      setLegacyPassword("");
      setVerifiedOldPassword("");
      setNewPin("");
      setError(null);
      setBusy(false);
      setDone(false);
    }
  }, [isOpen]);

  const finish = () => {
    setDone(true);
    onUnlocked?.();
    window.setTimeout(() => onClose(), 1600);
  };

  const handlePinUnlock = async (value: string) => {
    if (!unlockWallet || !value) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await unlockWallet(value.trim());
      if (!ok) {
        setError("Wrong PIN");
        setErrorTick((t) => t + 1);
        setPin("");
        return;
      }
      finish();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to unlock");
      setErrorTick((t) => t + 1);
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  const handlePasswordUnlock = async () => {
    if (!unlockWallet || !legacyPassword) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await unlockWallet(legacyPassword.trim());
      if (!ok) {
        setError("Wrong password");
        setLegacyPassword("");
        return;
      }
      // Wallet is now unlocked. If a migration callback is available,
      // route to PIN setup; otherwise just close.
      if (onMigrateToPin) {
        setVerifiedOldPassword(legacyPassword);
        setLegacyPassword("");
        setMode("setPinEnter");
      } else {
        finish();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to unlock");
      setLegacyPassword("");
    } finally {
      setBusy(false);
    }
  };

  const handleSetPin = async (confirmValue: string) => {
    if (!onMigrateToPin) return;
    if (confirmValue !== newPin) {
      setError("PINs do not match");
      setErrorTick((t) => t + 1);
      setNewPin("");
      setMode("setPinEnter");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ok = await onMigrateToPin(verifiedOldPassword, confirmValue);
      if (!ok) {
        setError("Could not save new PIN — try again");
        setErrorTick((t) => t + 1);
        return;
      }
      setVerifiedOldPassword("");
      setNewPin("");
      finish();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save new PIN");
      setErrorTick((t) => t + 1);
    } finally {
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
            <p className="text-sm font-bold text-foreground">
              {verifiedOldPassword ? "Wallet unlocked" : "Wallet unlocked"}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Lock className="w-4 h-4 text-primary" />
                {mode === "setPinEnter" || mode === "setPinConfirm"
                  ? "Set your PIN"
                  : "Unlock Wallet"}
              </h3>
              <button
                onClick={onClose}
                className="p-1 rounded-lg text-foreground/40 hover:text-foreground/70"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <AnimatePresence mode="wait">
              <motion.p
                key={mode}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="text-sm font-mono text-center text-foreground/60"
              >
                {mode === "pin" && "Enter your 6-digit sign-in PIN."}
                {mode === "password" && "Enter the password you originally set."}
                {mode === "setPinEnter" && "Choose a 6-digit PIN to use from now on."}
                {mode === "setPinConfirm" && "Re-enter to confirm."}
              </motion.p>
            </AnimatePresence>

            {error && (
              <p className="text-[12px] text-rose-400 text-center flex items-center justify-center gap-1.5">
                <AlertTriangle className="w-3 h-3" /> {error}
              </p>
            )}

            <div className="flex-1 flex items-center justify-center">
              <div style={{ maxWidth: 320, width: "100%" }}>
                <AnimatePresence mode="wait">
                  {mode === "pin" && (
                    <motion.div key="pin" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.22 }}>
                      <AppPinPad
                        value={pin}
                        onChange={setPin}
                        onComplete={(v) => handlePinUnlock(v)}
                        length={PIN_LENGTH}
                        errorTick={errorTick}
                        disabled={busy}
                      />
                    </motion.div>
                  )}

                  {mode === "password" && (
                    <motion.form
                      key="password"
                      initial={{ opacity: 0, x: 16 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 16 }}
                      transition={{ duration: 0.22 }}
                      onSubmit={(e) => { e.preventDefault(); handlePasswordUnlock(); }}
                      className="w-full space-y-3"
                    >
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={legacyPassword}
                        onChange={(e) => setLegacyPassword(e.target.value)}
                        placeholder="Wallet password"
                        autoFocus
                        maxLength={100}
                        className="w-full px-3 py-3 rounded-xl text-sm font-mono text-center bg-foreground/[0.04] border border-foreground/[0.08] text-foreground placeholder-foreground/30 focus:outline-none focus:border-foreground/30"
                      />
                      <button
                        type="submit"
                        disabled={busy || legacyPassword.length === 0}
                        className="w-full py-3 rounded-xl bg-foreground text-background font-bold font-mono text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Unlocking…</> : "Unlock"}
                      </button>
                    </motion.form>
                  )}

                  {mode === "setPinEnter" && (
                    <motion.div key="setPinEnter" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.22 }}>
                      <AppPinPad
                        value={newPin}
                        onChange={setNewPin}
                        onComplete={() => setMode("setPinConfirm")}
                        length={PIN_LENGTH}
                        disabled={busy}
                      />
                    </motion.div>
                  )}

                  {mode === "setPinConfirm" && (
                    <motion.div key="setPinConfirm" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.22 }}>
                      <AppPinPad
                        value={pin}
                        onChange={setPin}
                        onComplete={(v) => handleSetPin(v)}
                        length={PIN_LENGTH}
                        errorTick={errorTick}
                        disabled={busy}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {busy && mode !== "password" && (
              <div className="flex items-center justify-center gap-2 text-foreground/60">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs font-mono">
                  {mode === "setPinConfirm" ? "Updating PIN…" : "Unlocking…"}
                </span>
              </div>
            )}

            {/* Mode-switch footer. Hidden during PIN setup so the
                merchant doesn't bail mid-migration. */}
            {(mode === "pin" || mode === "password") && (
              <div className="flex items-center justify-center">
                {mode === "pin" && onMigrateToPin && (
                  <button
                    onClick={() => { setMode("password"); setError(null); setPin(""); }}
                    className="text-[11px] font-mono text-foreground/60 hover:text-foreground/80 flex items-center gap-1"
                  >
                    <Key className="w-3 h-3" />
                    Use password
                  </button>
                )}
                {mode === "password" && (
                  <button
                    onClick={() => { setMode("pin"); setError(null); setLegacyPassword(""); }}
                    className="text-[11px] font-mono text-foreground/60 hover:text-foreground/80 flex items-center gap-1"
                  >
                    <Check className="w-3 h-3" />
                    Use PIN
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}
