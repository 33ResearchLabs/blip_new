'use client';

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Delete, Fingerprint } from 'lucide-react';

interface AppPinPadProps {
  value: string;
  onChange: (next: string) => void;
  /** Fires when the user enters the final digit. */
  onComplete?: (value: string) => void;
  length?: number;
  /** Render in an error state (shake + red dots). Reset by the parent
   *  after the animation completes. */
  errorTick?: number;
  /** Disable input (e.g. during a hashing op or cooldown). */
  disabled?: boolean;
  /** Optional biometric button rendered in the bottom-left of the
   *  keypad. Bottom-right always has the backspace key. */
  onBiometric?: () => void;
  showBiometric?: boolean;
  /** Drives dot/key colors. Defaults to dark for callers (e.g. PinSheet)
   *  that haven't opted in to theming yet. */
  theme?: 'dark' | 'light';
}

const HAPTIC_MS = 12;

function vibrate(ms: number) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms);
    }
  } catch {
    // ignore — Safari rejects without throwing but TS doesn't know that
  }
}

/** 4-digit secure PIN entry. Renders a row of dots over a custom 3x4
 *  numeric keypad with haptic feedback and shake-on-error. The OS
 *  keyboard never opens — every digit comes from on-screen taps, so
 *  password-manager autofill and screen-recording don't leak the PIN. */
export function AppPinPad({
  value,
  onChange,
  onComplete,
  length = 4,
  errorTick = 0,
  disabled = false,
  onBiometric,
  showBiometric = false,
  theme = 'dark',
}: AppPinPadProps) {
  const isLight = theme === 'light';
  const keyBg = isLight ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.04)';
  const keyText = isLight ? 'rgba(15,23,42,0.95)' : '#ffffff';
  const iconColor = isLight ? 'rgba(15,23,42,0.75)' : 'rgba(255,255,255,0.80)';
  const dotFilled = isLight ? '#0f172a' : '#ffffff';
  const dotEmpty = isLight ? 'rgba(15,23,42,0.18)' : 'rgba(255,255,255,0.18)';
  // Drive the shake animation directly off the parent's tick — using
  // errorTick as the framer-motion `key` retriggers the animation on
  // every increment without needing a local state mirror. The vibrate
  // pulse is a true side effect on tick changes; fine inside an effect.
  useEffect(() => {
    if (errorTick > 0) vibrate(40);
  }, [errorTick]);

  const press = (digit: string) => {
    if (disabled) return;
    if (value.length >= length) return;
    vibrate(HAPTIC_MS);
    const next = value + digit;
    onChange(next);
    if (next.length === length) onComplete?.(next);
  };

  const backspace = () => {
    if (disabled) return;
    if (!value.length) return;
    vibrate(HAPTIC_MS);
    onChange(value.slice(0, -1));
  };

  return (
    <div className="select-none">
      {/* Dots */}
      <motion.div
        key={errorTick}
        animate={errorTick > 0 ? { x: [0, -10, 10, -8, 8, -4, 4, 0] } : { x: 0 }}
        transition={{ duration: 0.45 }}
        className="flex items-center justify-center gap-3 sm:gap-4 py-3 sm:py-4"
        aria-label="PIN entry indicator"
        role="img"
      >
        {Array.from({ length }).map((_, i) => {
          const filled = i < value.length;
          return (
            <div
              key={i}
              className="w-3 h-3  rounded-full"
              style={{
                background: errorTick > 0 && value.length === 0
                  ? '#dc2626'
                  : filled ? dotFilled : dotEmpty,
                transition: 'background-color 120ms',
              }}
            />
          );
        })}
      </motion.div>

      {/* Numeric keypad — width capped so buttons don't balloon on tablets */}
      <div
        className="grid grid-cols-3 gap-2 sm:gap-3 mx-auto"
        style={{ maxWidth: 'min(100%, 320px)' }}
        role="group"
        aria-label="PIN keypad"
      >
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <KeypadKey
            key={n}
            label={String(n)}
            onPress={() => press(String(n))}
            disabled={disabled}
            keyBg={keyBg}
            keyText={keyText}
          />
        ))}

        {/* Bottom row: biometric | 0 | backspace */}
        {showBiometric && onBiometric ? (
          <button
            type="button"
            onClick={() => { vibrate(HAPTIC_MS); onBiometric(); }}
            disabled={disabled}
            aria-label="Unlock with biometrics"
            className="aspect-square rounded-2xl flex items-center justify-center transition-colors disabled:opacity-40"
            style={{ background: keyBg }}
          >
            <Fingerprint className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: iconColor }} />
          </button>
        ) : (
          <div aria-hidden="true" />
        )}

        <KeypadKey
          label="0"
          onPress={() => press('0')}
          disabled={disabled}
          keyBg={keyBg}
          keyText={keyText}
        />

        <button
          type="button"
          onClick={backspace}
          disabled={disabled || !value.length}
          aria-label="Delete last digit"
          className="aspect-video rounded-2xl flex items-center justify-center transition-opacity disabled:opacity-30"
          style={{ background: keyBg }}
        >
          <Delete className="w-4 h-4 sm:w-5 sm:h-5" style={{ color: iconColor }} />
        </button>
      </div>
    </div>
  );
}

interface KeypadKeyProps {
  label: string;
  onPress: () => void;
  disabled: boolean;
  keyBg: string;
  keyText: string;
}

function KeypadKey({ label, onPress, disabled, keyBg, keyText }: KeypadKeyProps) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.92 }}
      onClick={onPress}
      disabled={disabled}
      className="aspect-video rounded-2xl p-2 flex items-center justify-center text-xl sm:text-2xl font-light disabled:opacity-30"
      style={{ background: keyBg, color: keyText }}
      aria-label={`Digit ${label}`}
    >
      <AnimatePresence>
        <motion.span
          key={label}
          initial={{ opacity: 1 }}
          className="font-mono tracking-wider "
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
