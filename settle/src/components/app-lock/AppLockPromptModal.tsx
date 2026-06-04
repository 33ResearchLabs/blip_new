'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, ShieldCheck, X } from 'lucide-react';
import { AppPinPad } from './AppPinPad';
import { verifyAppPin, APP_PIN_LENGTH, MAX_PIN_FAILURES } from '@/lib/auth/appPin';
import { useUserTheme } from '@/hooks/useUserTheme';

interface AppLockPromptModalProps {
  userId: string;
  title?: string;
  description?: string;
  /** Receives the verified PIN plaintext — needed by callers that
   *  re-wrap it (e.g. biometric enrollment). Most callers ignore it. */
  onSuccess: (pin: string) => void;
  onClose: () => void;
  onLockout?: () => void;
}

/** Re-auth modal for sensitive Settings actions (change PIN, enroll
 *  biometric, remove PIN). Smaller than AppLockScreen and dismissible.
 *  Reuses the same verify path so the cooldown / wipe policy is shared. */
export function AppLockPromptModal({
  userId,
  title = 'Enter App PIN',
  description,
  onSuccess,
  onClose,
  onLockout,
}: AppLockPromptModalProps) {
  const { theme } = useUserTheme();
  const isLight = theme === 'light';

  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [errorTick, setErrorTick] = useState(0);
  const [busy, setBusy] = useState(false);

  const flashError = (msg: string) => {
    setError(msg);
    setErrorTick((n) => n + 1);
    setPin('');
  };

  const handleComplete = async (entered: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await verifyAppPin(userId, entered);
      if (res.ok) {
        onSuccess(entered);
        return;
      }
      if (res.wiped) {
        flashError('Too many wrong tries. PIN cleared.');
        onLockout?.();
        return;
      }
      if (res.cooldownSeconds > 0) {
        flashError(`Try again in ${res.cooldownSeconds}s.`);
        return;
      }
      const left = MAX_PIN_FAILURES - res.failures;
      flashError(left <= 3 ? `Wrong PIN — ${left} ${left === 1 ? 'try' : 'tries'} left` : 'Wrong PIN');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Dimmed backdrop — tap to dismiss (unless mid-verify). */}
      <div
        className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-sm"
        onClick={() => { if (!busy) onClose(); }}
      />

      {/* Bottom sheet — theme-aware surface so it reads correctly in the
          cream (light) user theme as well as dark. Slides up from the
          bottom edge. */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 38 }}
        className="fixed inset-x-0 bottom-0 z-[131] bg-surface-base text-text-primary rounded-t-3xl border-t border-border-medium shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto max-w-[420px] px-5 pt-3 pb-[max(env(safe-area-inset-bottom,16px),20px)] space-y-5">
          {/* Grab handle */}
          <div className="mx-auto h-1 w-9 rounded-full bg-text-tertiary/40" />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl flex items-center justify-center bg-accent-subtle">
                <ShieldCheck className="w-4 h-4 text-accent" />
              </div>
              <h3 className="text-base font-bold text-text-primary">{title}</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="p-1.5 rounded-lg text-text-tertiary hover:bg-surface-hover disabled:opacity-40"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {description && (
            <p className="text-[12px] text-text-secondary leading-relaxed">{description}</p>
          )}

          {error && (
            <div className="px-3 py-2 rounded-lg text-[11px] text-center bg-error-dim border border-error-border text-error">
              {error}
            </div>
          )}

          <AppPinPad
            value={pin}
            onChange={(v) => { setPin(v); if (error) setError(''); }}
            onComplete={handleComplete}
            length={APP_PIN_LENGTH}
            errorTick={errorTick}
            disabled={busy}
            theme={isLight ? 'light' : 'dark'}
          />

          {busy && (
            <div className="flex items-center justify-center gap-2 text-[11px] text-text-tertiary">
              <Loader2 className="w-3 h-3 animate-spin" /> Verifying…
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}
