'use client';

import { useState } from 'react';
import { Loader2, Lock, Key } from 'lucide-react';
import { motion } from 'framer-motion';
import { colors } from "@/lib/design/theme";
import { AppPinPad } from '@/components/app-lock/AppPinPad';

const PIN_LENGTH = 6;

interface UnlockWalletPromptProps {
  onUnlock: (password: string) => Promise<boolean>;
  onForgotPassword?: () => void;
  onCreateNew?: () => void;
  onClose?: () => void;
}

export function UnlockWalletPrompt({ onUnlock, onForgotPassword, onCreateNew, onClose }: UnlockWalletPromptProps) {
  const [password, setPassword] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [error, setError] = useState('');
  const [errorTick, setErrorTick] = useState(0);

  const handleUnlock = async (pin: string) => {
    if (!pin) return;
    setError('');
    setIsUnlocking(true);

    try {
      const success = await onUnlock(pin);
      if (!success) {
        setError('Wrong PIN');
        setErrorTick(t => t + 1);
        setPassword('');
      }
    } catch {
      setError('Failed to decrypt wallet');
      setErrorTick(t => t + 1);
      setPassword('');
    } finally {
      setIsUnlocking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-t-3xl sm:rounded-2xl w-full sm:max-w-sm shadow-2xl p-5 space-y-3 max-h-[92vh] overflow-y-auto"
        style={{
          background: `linear-gradient(${colors.surface.card}, ${colors.surface.card}), ${colors.bg.primary}`,
          border: `1px solid ${colors.border.subtle}`,
          paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))',
        }}
      >
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: colors.surface.active }}>
            <Lock className="w-4 h-4" style={{ color: '#fff' }} />
          </div>
          <h2 className="text-lg font-bold font-mono" style={{ color: colors.text.primary }}>Unlock Wallet</h2>
        </div>

        <p className="text-[11px] font-mono text-center" style={{ color: colors.text.secondary }}>
          Enter your 6-digit sign-in PIN.
        </p>

        {error && (
          <div className="p-2 rounded-lg text-xs font-mono text-center" style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.15)', color: '#dc2626' }}>
            {error}
          </div>
        )}

        <div style={{ maxWidth: 260, margin: '0 auto' }}>
          <AppPinPad
            value={password}
            onChange={setPassword}
            onComplete={(v) => handleUnlock(v)}
            length={PIN_LENGTH}
            errorTick={errorTick}
            disabled={isUnlocking}
          />
        </div>

        {isUnlocking && (
          <div className="flex items-center justify-center gap-2" style={{ color: colors.text.secondary }}>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs font-mono">Unlocking…</span>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-3">
            {onForgotPassword && (
              <button
                onClick={onForgotPassword}
                className="text-[11px] font-mono transition-colors flex items-center gap-1"
                style={{ color: colors.text.secondary }}
              >
                <Key className="w-3 h-3" />
                Import key
              </button>
            )}
            {onCreateNew && (
              <button
                onClick={onCreateNew}
                className="text-[11px] font-mono transition-colors flex items-center gap-1"
                style={{ color: colors.text.tertiary }}
              >
                <Lock className="w-3 h-3" />
                New wallet
              </button>
            )}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-[11px] font-mono transition-colors"
              style={{ color: colors.text.tertiary }}
            >
              Cancel
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
