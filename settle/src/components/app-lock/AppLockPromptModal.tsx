'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, ShieldCheck, X } from 'lucide-react';
import { AppPinPad } from './AppPinPad';
import { verifyAppPin, APP_PIN_LENGTH, MAX_PIN_FAILURES } from '@/lib/auth/appPin';

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
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      onClick={() => { if (!busy) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.97, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-sm rounded-3xl p-6 space-y-5 border border-white/[0.06] shadow-2xl"
        style={{ background: '#0d0d0d' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl flex items-center justify-center bg-accent/20">
              <ShieldCheck className="w-4 h-4 text-accent" />
            </div>
            <h3 className="text-base font-bold text-white font-mono">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-1.5 rounded-lg text-white/40 hover:bg-white/[0.04] disabled:opacity-40"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {description && (
          <p className="text-[12px] text-white/55 font-mono leading-relaxed">{description}</p>
        )}

        {error && (
          <div className="px-3 py-2 rounded-lg text-[11px] font-mono text-center bg-red-500/10 border border-red-500/20 text-red-400">
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
        />

        {busy && (
          <div className="flex items-center justify-center gap-2 text-[11px] text-white/50 font-mono">
            <Loader2 className="w-3 h-3 animate-spin" /> Verifying…
          </div>
        )}
      </motion.div>
    </div>
  );
}
