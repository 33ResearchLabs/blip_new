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

import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, AlertTriangle, Check, Key } from "lucide-react";
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

// ─── WatchBot ────────────────────────────────────────────────────────────────
// A tiny robot that reacts to what the user is doing:
//   · eyes track left-right based on input progress
//   · covers its eyes (hands slide up) when in password mode
//   · squints + shakes slightly on error
//   · antennas wiggle on success
interface WatchBotProps {
  /** 0–1 progress of pin or password length */
  progress: number;
  isPassword: boolean;
  hasError: boolean;
  isDone: boolean;
}

function WatchBot({ progress, isPassword, hasError, isDone }: WatchBotProps) {
  // Pupil x offset: -4 → +4 px based on progress
  const pupilX = -4 + progress * 8;

  // Eye openness: normal=1, error squint=0.35, password peek=0.55
  const eyeOpen = hasError ? 0.35 : isPassword ? 0.55 : 1;

  // Hand height: slides up to cover eyes in password mode
  const handY = isPassword ? 0 : 28;

  return (
    <div style={{ width: 64, height: 64, position: "relative" }}>
      {/* keyframe styles injected once */}
      <style>{`
        @keyframes bot-blink {
          0%,92%,100% { transform: scaleY(1); }
          95% { transform: scaleY(0.08); }
        }
        @keyframes bot-antenna-idle {
          0%,100% { transform: rotate(-2deg); }
          50% { transform: rotate(2deg); }
        }
        @keyframes bot-antenna-done {
          0%,100% { transform: rotate(-18deg); }
          50% { transform: rotate(18deg); }
        }
        @keyframes bot-glow {
          0%,100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>

      <svg
        viewBox="0 0 64 64"
        width="64"
        height="64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* ── Antenna left ── */}
        <g
          style={{
            transformOrigin: "22px 16px",
            animation: isDone
              ? "bot-antenna-done 0.35s ease-in-out infinite"
              : "bot-antenna-idle 2.8s ease-in-out infinite",
          }}
        >
          <line x1="22" y1="16" x2="18" y2="8" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="18" cy="7" r="2" fill={isDone ? "#f5f5f7" : "rgba(255,255,255,0.25)"} />
        </g>

        {/* ── Antenna right ── */}
        <g
          style={{
            transformOrigin: "42px 16px",
            animation: isDone
              ? "bot-antenna-done 0.35s ease-in-out infinite 0.17s"
              : "bot-antenna-idle 2.8s ease-in-out infinite 1.4s",
          }}
        >
          <line x1="42" y1="16" x2="46" y2="8" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="46" cy="7" r="2" fill={isDone ? "#f5f5f7" : "rgba(255,255,255,0.25)"} />
        </g>

        {/* ── Head ── */}
        <rect
          x="14" y="16" width="36" height="28"
          rx="8"
          fill="#1a1b1f"
          stroke="rgba(255,255,255,0.10)"
          strokeWidth="1"
        />

        {/* ── Inner face plate ── */}
        <rect
          x="18" y="20" width="28" height="20"
          rx="5"
          fill="rgba(255,255,255,0.03)"
        />

        {/* ── Eye sockets ── */}
        <rect x="20" y="24" width="10" height="10" rx="3" fill="rgba(0,0,0,0.55)" />
        <rect x="34" y="24" width="10" height="10" rx="3" fill="rgba(0,0,0,0.55)" />

        {/* ── Eyes (blink + squint via scaleY, track via translateX) ── */}
        {/* Left eye */}
        <g
          style={{
            transformOrigin: "25px 29px",
            animation: !isPassword && !hasError ? "bot-blink 4s ease-in-out infinite" : undefined,
            transform: `scaleY(${eyeOpen})`,
          }}
        >
          <circle cx="25" cy="29" r="3.5" fill="#e8e8e8" />
          <circle
            cx={25 + pupilX * 0.55}
            cy="29"
            r="1.8"
            fill="#0a0a0c"
            style={{ transition: "cx 0.25s ease-out" }}
          />
          {/* pupil shine */}
          <circle cx={24.2 + pupilX * 0.55} cy="27.8" r="0.7" fill="rgba(255,255,255,0.7)" />
        </g>

        {/* Right eye */}
        <g
          style={{
            transformOrigin: "39px 29px",
            animation: !isPassword && !hasError ? "bot-blink 4s ease-in-out infinite 0.07s" : undefined,
            transform: `scaleY(${eyeOpen})`,
          }}
        >
          <circle cx="39" cy="29" r="3.5" fill="#e8e8e8" />
          <circle
            cx={39 + pupilX * 0.55}
            cy="29"
            r="1.8"
            fill="#0a0a0c"
            style={{ transition: "cx 0.25s ease-out" }}
          />
          <circle cx={38.2 + pupilX * 0.55} cy="27.8" r="0.7" fill="rgba(255,255,255,0.7)" />
        </g>

        {/* ── Mouth: straight → slight smile on done ── */}
        {isDone ? (
          <path
            d="M26 35 Q32 39 38 35"
            stroke="rgba(255,255,255,0.45)"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
          />
        ) : (
          <line
            x1="26" y1="36" x2="38" y2="36"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        )}

        {/* ── Ear nubs ── */}
        <rect x="11" y="26" width="3" height="8" rx="1.5" fill="rgba(255,255,255,0.08)" />
        <rect x="50" y="26" width="3" height="8" rx="1.5" fill="rgba(255,255,255,0.08)" />

        {/* ── Chin / neck ── */}
        <rect x="28" y="44" width="8" height="4" rx="2" fill="rgba(255,255,255,0.06)" />

        {/* ── Hands that slide up to cover eyes in password mode ── */}
        {/* Left hand */}
        <g
          style={{
            transform: `translateY(${handY}px)`,
            transition: "transform 0.4s cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          <rect x="12" y="22" width="12" height="8" rx="4"
            fill="#1a1b1f"
            stroke="rgba(255,255,255,0.14)"
            strokeWidth="1"
          />
          {/* knuckle lines */}
          <line x1="16" y1="22" x2="16" y2="24" stroke="rgba(255,255,255,0.1)" strokeWidth="0.8" />
          <line x1="19" y1="22" x2="19" y2="24" stroke="rgba(255,255,255,0.1)" strokeWidth="0.8" />
        </g>

        {/* Right hand */}
        <g
          style={{
            transform: `translateY(${handY}px)`,
            transition: "transform 0.4s cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          <rect x="40" y="22" width="12" height="8" rx="4"
            fill="#1a1b1f"
            stroke="rgba(255,255,255,0.14)"
            strokeWidth="1"
          />
          <line x1="45" y1="22" x2="45" y2="24" stroke="rgba(255,255,255,0.1)" strokeWidth="0.8" />
          <line x1="48" y1="22" x2="48" y2="24" stroke="rgba(255,255,255,0.1)" strokeWidth="0.8" />
        </g>

        {/* ── Status LED on forehead ── */}
        <circle
          cx="32" cy="19" r="1.5"
          fill={isDone ? "#f5f5f7" : hasError ? "#f87171" : "rgba(255,255,255,0.18)"}
          style={{
            animation: isDone || hasError
              ? "bot-glow 0.6s ease-in-out infinite"
              : "bot-glow 3s ease-in-out infinite",
          }}
        />
      </svg>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

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

  // Bot props derived from current state
  const botProgress = useMemo(() => {
    if (mode === "password") return Math.min(legacyPassword.length / 16, 1);
    if (mode === "setPinEnter") return Math.min(newPin.length / PIN_LENGTH, 1);
    return Math.min(pin.length / PIN_LENGTH, 1);
  }, [mode, pin, newPin, legacyPassword]);

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
        role="dialog"
        aria-modal="true"
        aria-label="Unlock wallet"
        className="w-full max-w-md bg-background border border-foreground/[0.08] rounded-3xl p-6 sm:p-7 space-y-5 flex flex-col shadow-2xl"
        style={{
          minHeight: "min(660px, 88vh)",
          maxHeight: "95vh",
          paddingTop: "max(1.5rem, env(safe-area-inset-top))",
          paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
        }}
      >
        {done ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
            <WatchBot progress={1} isPassword={false} hasError={false} isDone />
            <p className="text-sm font-bold text-foreground">Wallet unlocked</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-foreground">
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

            {/* Bot sits between title and subtitle */}
            <div className="flex justify-center">
              <motion.div
                animate={error ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
                transition={{ duration: 0.38 }}
              >
                <WatchBot
                  progress={botProgress}
                  isPassword={mode === "password"}
                  hasError={!!error}
                  isDone={false}
                />
              </motion.div>
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
