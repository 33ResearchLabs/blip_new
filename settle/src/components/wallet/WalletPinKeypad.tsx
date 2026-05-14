"use client";

/**
 * WalletPinKeypad
 * ───────────────
 * Controlled 6-digit PIN entry for the user-side wallet password.
 *
 * Background: as of the PIN unification, the user-facing wallet password
 * IS a 6-digit numeric PIN — the same secret unlocks the wallet AND
 * authorises payments. (Merchants keep free-form passwords; this component
 * is user-side only.)
 *
 * UX model — OTP-style native keyboard:
 *   - The visible UI is 6 dot/slot boxes that fill as the user types.
 *   - Behind them sits an invisible `<input inputMode="numeric">` that
 *     captures focus on tap. Mobile browsers pop the native numeric
 *     keyboard, which is faster and matches `inputMode="numeric"` autofill
 *     hints (one-time-code, SMS paste, etc).
 *   - Desktop users can just type — the input is focused on mount.
 *
 * Why no custom on-screen pad: previous revision rendered an always-
 * visible 3×4 numeric grid. That added a lot of vertical real estate AND
 * blocked native autofill paths (banks' "paste OTP" buttons, password
 * managers). The hidden-input approach is the standard OTP pattern.
 *
 * `validatePasswordStrength` in `lib/wallet/embeddedWallet.ts` already
 * accepts 4-6 digit numeric strings, so submit handlers don't change.
 */

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** Small label above the dots row. Defaults to "PIN". */
  label?: string;
  /** Optional helper text below the slots. */
  hint?: string;
  /** Disable input while a submit is in flight. */
  disabled?: boolean;
  /** Auto-focus on mount. Defaults to false so two stacked keypads
   *  (Set + Confirm) don't fight for focus. Parent sets true on the
   *  first one. */
  autoFocus?: boolean;
  /** Render an eye icon that toggles the slots between dots and visible
   *  digits. Opt-in because not every callsite wants it — e.g. unlock
   *  should keep dots-only, but Import wants the toggle so the user can
   *  double-check their PIN against the Confirm slot. */
  showToggle?: boolean;
}

const PIN_LENGTH = 6;

export function WalletPinKeypad({
  value,
  onChange,
  label = "PIN",
  hint,
  disabled,
  autoFocus,
  showToggle,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [revealed, setRevealed] = useState(false);

  // Auto-focus on mount when requested. iOS Safari sometimes needs an
  // explicit re-focus after the dots become tappable, so we run it on
  // mount AND on the first non-disabled render.
  useEffect(() => {
    if (autoFocus && !disabled && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus, disabled]);

  // Strip everything that isn't a digit and clamp to 6. Handles paste of
  // codes with spaces / dashes (e.g. "12 34 56") and oversize pastes.
  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleaned = e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH);
    onChange(cleaned);
  };

  // Tap anywhere on the dots row → focus the hidden input → keyboard pops.
  const focusInput = () => {
    if (disabled) return;
    inputRef.current?.focus();
  };

  return (
    <div className="space-y-2">
      {(label || showToggle) && (
        <div className="flex items-center justify-between">
          {label ? (
            <p className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
              {label}
            </p>
          ) : (
            <span />
          )}
          {showToggle && (
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              disabled={disabled}
              aria-label={revealed ? "Hide PIN" : "Show PIN"}
              aria-pressed={revealed}
              className="inline-flex items-center gap-1 text-[10px] text-white/40 hover:text-white/70 font-mono uppercase tracking-wider disabled:opacity-40 transition-colors"
            >
              {revealed ? (
                <>
                  <EyeOff className="w-3 h-3" /> Hide
                </>
              ) : (
                <>
                  <Eye className="w-3 h-3" /> Show
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Tap target: 6 slots, fills as user types. The whole row is one
          button-like surface that forwards focus to the hidden input.
          When `showToggle` is enabled and the user has tapped "Show",
          each filled slot renders the actual digit instead of a dot. */}
      <button
        type="button"
        onClick={focusInput}
        disabled={disabled}
        className="relative w-full flex items-center justify-center gap-3 py-4 rounded-xl bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.18] focus-within:border-primary/50 disabled:opacity-50 transition-colors cursor-text"
        aria-label={label}
      >
        {Array.from({ length: PIN_LENGTH }).map((_, i) => {
          const filled = i < value.length;
          if (filled && revealed) {
            return (
              <span
                key={i}
                className="text-[18px] font-mono font-semibold text-primary tabular-nums select-none"
                style={{ minWidth: 14, textAlign: "center" }}
              >
                {value[i]}
              </span>
            );
          }
          return (
            <div
              key={i}
              className={`rounded-full transition-all ${
                filled ? "bg-primary scale-100" : "border-2 border-white/20 scale-90"
              }`}
              style={{ width: 14, height: 14 }}
            />
          );
        })}

        {/* Hidden input that owns the value and triggers the native
            numeric keyboard on tap. `inputMode="numeric"` is what pops
            the digit-only keyboard on iOS / Android; `type="tel"` is a
            belt-and-braces fallback for older browsers that ignore
            inputMode. `autoComplete="one-time-code"` lets iOS suggest
            SMS codes (handy when this is reused for OTP entry later). */}
        <input
          ref={inputRef}
          type="tel"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={PIN_LENGTH}
          value={value}
          onChange={handleInput}
          disabled={disabled}
          className="absolute inset-0 w-full h-full opacity-0 cursor-text"
          aria-hidden="false"
        />
      </button>

      {hint && (
        <p className="text-[10px] text-white/40 font-mono">{hint}</p>
      )}
    </div>
  );
}
