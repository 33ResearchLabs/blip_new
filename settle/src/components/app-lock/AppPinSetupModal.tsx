'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, ShieldCheck, X } from 'lucide-react';
import { AppPinPad } from './AppPinPad';
import { setAppPin, validateAppPinStrength, APP_PIN_LENGTH } from '@/lib/auth/appPin';

interface AppPinSetupModalProps {
  userId: string;
  /** "set" for the first-time post-signup flow, "change" for re-keying
   *  from Settings. The caller is responsible for verifying the
   *  current PIN before opening this in "change" mode. */
  mode?: 'set' | 'change';
  /** Fired after the PIN is saved. Receives the just-set PIN plaintext
   *  for callers that need to re-wrap it in the same flow (e.g. a
   *  combined "Set PIN + Enable Biometrics" path). The plaintext lives
   *  in React memory only — it is never persisted by this component. */
  onDone: (pin: string) => void;
  onClose?: () => void;
  /** Hide the close button — used by the mandatory post-signup flow. */
  dismissible?: boolean;
}

type Step = 'enter' | 'confirm';

/** Two-step enter + confirm flow, with weak-PIN rejection before the
 *  confirm step (so users get fast feedback). The verifier (PBKDF2
 *  hash + salt) lands in localStorage; the PIN plaintext never does. */
export function AppPinSetupModal({
  userId,
  mode = 'set',
  onDone,
  onClose,
  dismissible = true,
}: AppPinSetupModalProps) {
  const [step, setStep] = useState<Step>('enter');
  const [first, setFirst] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [errorTick, setErrorTick] = useState(0);
  const [busy, setBusy] = useState(false);

  const flashError = (msg: string) => {
    setError(msg);
    setErrorTick((n) => n + 1);
  };

  const handleFirstComplete = (val: string) => {
    setError('');
    const weak = validateAppPinStrength(val);
    if (weak) {
      flashError(weak);
      setFirst('');
      return;
    }
    setStep('confirm');
  };

  const handleConfirmComplete = async (val: string) => {
    if (val !== first) {
      flashError('PINs do not match');
      setConfirm('');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await setAppPin(userId, first);
      if (!res.ok) {
        flashError(res.message ?? 'Could not save PIN. Try again.');
        setConfirm('');
        return;
      }
      onDone(first);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      onClick={() => { if (dismissible && !busy) onClose?.(); }}
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
            <h3 className="text-base font-bold text-white font-mono">
              {mode === 'change' ? 'Change App PIN' : 'Set App PIN'}
            </h3>
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={() => onClose?.()}
              disabled={busy}
              className="p-1.5 rounded-lg text-white/40 hover:bg-white/[0.04] disabled:opacity-40"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <p className="text-[12px] text-white/55 font-mono leading-relaxed">
          {step === 'enter'
            ? `Choose a ${APP_PIN_LENGTH}-digit PIN to unlock the app. Use something you can remember but others can’t guess.`
            : 'Re-enter the same PIN to confirm.'}
        </p>

        {error && (
          <div className="px-3 py-2 rounded-lg text-[11px] font-mono bg-red-500/10 border border-red-500/20 text-red-400">
            {error}
          </div>
        )}

        {step === 'enter' ? (
          <AppPinPad
            value={first}
            onChange={(v) => { setFirst(v); if (error) setError(''); }}
            onComplete={handleFirstComplete}
            errorTick={errorTick}
            disabled={busy}
          />
        ) : (
          <AppPinPad
            value={confirm}
            onChange={(v) => { setConfirm(v); if (error) setError(''); }}
            onComplete={handleConfirmComplete}
            errorTick={errorTick}
            disabled={busy}
          />
        )}

        {step === 'confirm' && !busy && (
          <button
            type="button"
            onClick={() => { setStep('enter'); setConfirm(''); setError(''); }}
            className="w-full py-2 rounded-lg text-[11px] text-white/50 font-mono hover:bg-white/[0.04]"
          >
            ← Use a different PIN
          </button>
        )}

        {busy && (
          <div className="flex items-center justify-center gap-2 text-[11px] text-white/50 font-mono">
            <Loader2 className="w-3 h-3 animate-spin" /> Saving…
          </div>
        )}
      </motion.div>
    </div>
  );
}
