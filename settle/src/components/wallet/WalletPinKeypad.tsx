"use client";

/**
 * WalletPinKeypad
 * ───────────────
 * Controlled numeric keypad for the user-side wallet password.
 *
 * Background: as of the PIN unification, the user-facing wallet password
 * IS a 6-digit numeric PIN — the same secret unlocks the wallet AND
 * authorises payments. (Merchants keep free-form passwords; this component
 * is user-side only.)
 *
 * The component is a controlled input — the parent owns the value and the
 * keypad just provides the entry UI. That keeps it a drop-in replacement
 * for the previous `<input type="password" />` slot in Create / Import
 * forms without changing the submit handlers.
 *
 * `validatePasswordStrength` in `lib/wallet/embeddedWallet.ts` already
 * accepts 4-6 digit numeric strings as valid wallet passwords, so the
 * pre-existing submit path works unchanged with a 6-digit PIN.
 */

import { Delete } from "lucide-react";

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** Small label above the dots row. Defaults to "PIN". */
  label?: string;
  /** Optional helper text below the keypad. */
  hint?: string;
  /** Disable input while a submit is in flight. */
  disabled?: boolean;
}

const PIN_LENGTH = 6;

export function WalletPinKeypad({
  value,
  onChange,
  label = "PIN",
  hint,
  disabled,
}: Props) {
  const push = (digit: string) => {
    if (disabled) return;
    if (value.length >= PIN_LENGTH) return;
    onChange(value + digit);
  };
  const pop = () => {
    if (disabled) return;
    onChange(value.slice(0, -1));
  };

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
        {label}
      </p>

      {/* 6 dots — filled as the user types. */}
      <div className="flex items-center justify-center gap-3 py-2">
        {Array.from({ length: PIN_LENGTH }).map((_, i) => {
          const filled = i < value.length;
          return (
            <div
              key={i}
              className={`rounded-full transition-all ${
                filled ? "bg-primary" : "border-2 border-white/15"
              }`}
              style={{ width: 12, height: 12 }}
            />
          );
        })}
      </div>

      {/* Numeric grid */}
      <div className="grid grid-cols-3 gap-2 max-w-[280px] mx-auto">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            type="button"
            disabled={disabled}
            onClick={() => push(d)}
            className="py-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-[20px] font-semibold text-white disabled:opacity-40 transition-colors"
          >
            {d}
          </button>
        ))}
        <div />
        <button
          type="button"
          disabled={disabled}
          onClick={() => push("0")}
          className="py-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-[20px] font-semibold text-white disabled:opacity-40 transition-colors"
        >
          0
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={pop}
          aria-label="Delete last digit"
          className="py-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] inline-flex items-center justify-center disabled:opacity-40 transition-colors"
        >
          <Delete className="w-4 h-4 text-white/80" />
        </button>
      </div>

      {hint && (
        <p className="text-[10px] text-white/40 font-mono text-center">{hint}</p>
      )}
    </div>
  );
}
