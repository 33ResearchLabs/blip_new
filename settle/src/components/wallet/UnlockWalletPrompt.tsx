'use client';

import { useState } from 'react';
import { Loader2, Lock, Key, AlertTriangle, Check, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { colors } from "@/lib/design/theme";
import { AppPinPad } from '@/components/app-lock/AppPinPad';
import { useUserTheme } from '@/hooks/useUserTheme';

const PIN_LENGTH = 6;

type Mode = 'pin' | 'password' | 'setPinEnter' | 'setPinConfirm';

interface UnlockWalletPromptProps {
  onUnlock: (password: string) => Promise<boolean>;
  /** Optional. When provided, the prompt offers a one-time migration:
   *  unlock with legacy password, then set a 6-digit PIN that re-encrypts
   *  the wallet. Without this, only the keypad path is shown. */
  onMigrateToPin?: (oldPassword: string, newPin: string) => Promise<boolean>;
  onForgotPassword?: () => void;
  onCreateNew?: () => void;
  onClose?: () => void;
}

export function UnlockWalletPrompt({
  onUnlock,
  onMigrateToPin,
  onForgotPassword,
  onCreateNew,
  onClose,
}: UnlockWalletPromptProps) {
  const [mode, setMode] = useState<Mode>('pin');
  const [pin, setPin] = useState('');
  const [legacyPassword, setLegacyPassword] = useState('');
  // Held briefly between password unlock and PIN setup so we can
  // re-encrypt the blob. Cleared as soon as migration finishes.
  const [verifiedOldPassword, setVerifiedOldPassword] = useState('');
  const [newPin, setNewPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorTick, setErrorTick] = useState(0);
  // The lock card themes itself via CSS vars (light/dark), but AppPinPad takes
  // a JS `theme` prop. Keep them in sync — it was hardcoded "light" (near-black
  // keys), which rendered invisible on the dark card in dark mode.
  const { theme } = useUserTheme();
  const padTheme: 'light' | 'dark' = theme === 'light' ? 'light' : 'dark';

  const resetError = () => { setError(''); };

  const handlePinUnlock = async (value: string) => {
    if (!value) return;
    setBusy(true);
    resetError();
    try {
      const ok = await onUnlock(value);
      if (!ok) {
        setError('Wrong PIN');
        setErrorTick(t => t + 1);
        setPin('');
      }
    } catch {
      setError('Failed to decrypt wallet');
      setErrorTick(t => t + 1);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const handlePasswordUnlock = async () => {
    if (!legacyPassword) return;
    setBusy(true);
    resetError();
    try {
      // If the parent gave us a migration callback, defer the actual
      // unlock until we've set the new PIN — that way the password +
      // keypair stay in scope until we re-encrypt. With no migration
      // callback we just unlock and bail.
      if (onMigrateToPin) {
        // Verify the password works by attempting a normal unlock.
        const ok = await onUnlock(legacyPassword);
        if (!ok) {
          setError('Wrong password');
          setLegacyPassword('');
          return;
        }
        // Save the verified password so the next step can re-encrypt.
        setVerifiedOldPassword(legacyPassword);
        setLegacyPassword('');
        setMode('setPinEnter');
      } else {
        const ok = await onUnlock(legacyPassword);
        if (!ok) {
          setError('Wrong password');
          setLegacyPassword('');
        }
      }
    } catch {
      setError('Failed to decrypt wallet');
      setLegacyPassword('');
    } finally {
      setBusy(false);
    }
  };

  const handleSetPin = async (confirmValue: string) => {
    if (!onMigrateToPin) return;
    if (confirmValue !== newPin) {
      setError('PINs do not match');
      setErrorTick(t => t + 1);
      setNewPin('');
      setMode('setPinEnter');
      return;
    }
    setBusy(true);
    resetError();
    try {
      const ok = await onMigrateToPin(verifiedOldPassword, confirmValue);
      if (!ok) {
        setError('Could not save new PIN — try again');
        setErrorTick(t => t + 1);
        return;
      }
      // Wallet is now unlocked under the new PIN — context already
      // marked it 'unlocked' inside migrateToPin. Wipe sensitive state.
      setVerifiedOldPassword('');
      setNewPin('');
    } catch {
      setError('Could not save new PIN');
      setErrorTick(t => t + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}>
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-3xl w-full max-w-md shadow-2xl p-6 sm:p-7 space-y-5 flex flex-col"
        style={{
          background: `linear-gradient(${colors.surface.card}, ${colors.surface.card}), ${colors.bg.primary}`,
          border: `1px solid ${colors.border.subtle}`,
          // Give the card a taller, more substantial footprint. The keypad
          // area (flex-1) absorbs the extra height by centering itself, so the
          // increased size reads as balanced breathing room rather than empty
          // space dumped at the bottom.
          minHeight: 'min(600px, 80vh)',
          maxHeight: '95vh',
          paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
          paddingBottom: 'max(1.75rem, env(safe-area-inset-bottom))',
        }}
      >
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: colors.accent.subtle }}>
            <Lock className="w-4 h-4" style={{ color: colors.accent.primary }} />
          </div>
          <h2 className="text-lg font-bold font-mono" style={{ color: colors.text.primary }}>
            {mode === 'setPinEnter' || mode === 'setPinConfirm' ? 'Set your PIN' : 'Unlock Wallet'}
          </h2>
          {/* Close (X) — top-right. Hidden during PIN-setup so the user
              doesn't bail mid-migration. */}
          {onClose && mode !== 'setPinEnter' && mode !== 'setPinConfirm' && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="ml-auto w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-black/5"
              style={{ color: colors.text.tertiary }}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <AnimatePresence mode="wait">
          <motion.p
            key={mode}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="text-sm font-mono text-center"
            style={{ color: colors.text.secondary }}
          >
            {mode === 'pin' && 'Enter your 6-digit sign-in PIN.'}
            {mode === 'password' && 'Enter the password you originally set.'}
            {mode === 'setPinEnter' && 'Choose a 6-digit PIN to use from now on.'}
            {mode === 'setPinConfirm' && 'Re-enter to confirm.'}
          </motion.p>
        </AnimatePresence>

        {error && (
          <div className="rounded-lg px-3 py-2 text-[12px] font-mono text-center flex items-center justify-center gap-1.5" style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.18)', color: '#dc2626' }}>
            <AlertTriangle className="w-3 h-3" /> {error}
          </div>
        )}

        <div className="flex-1 flex items-center justify-center">
          <div style={{ maxWidth: 320, width: '100%' }}>
            <AnimatePresence mode="wait">
              {mode === 'pin' && (
                <motion.div key="pin" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.22 }}>
                  <AppPinPad
                    value={pin}
                    onChange={setPin}
                    onComplete={(v) => handlePinUnlock(v)}
                    length={PIN_LENGTH}
                    errorTick={errorTick}
                    disabled={busy}
                    theme={padTheme}
                  />
                </motion.div>
              )}

              {mode === 'password' && (
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
                    className="w-full px-3 py-3 rounded-xl text-sm font-mono text-center outline-none"
                    style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}`, color: colors.text.primary }}
                  />
                  <button
                    type="submit"
                    disabled={busy || legacyPassword.length === 0}
                    className="w-full py-3 rounded-xl font-bold font-mono text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ background: colors.accent.primary, color: colors.accent.text }}
                  >
                    {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Unlocking…</> : 'Unlock'}
                  </button>
                </motion.form>
              )}

              {mode === 'setPinEnter' && (
                <motion.div key="setPinEnter" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.22 }}>
                  <AppPinPad
                    value={newPin}
                    onChange={setNewPin}
                    onComplete={() => setMode('setPinConfirm')}
                    length={PIN_LENGTH}
                    disabled={busy}
                    theme={padTheme}
                  />
                </motion.div>
              )}

              {mode === 'setPinConfirm' && (
                <motion.div key="setPinConfirm" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.22 }}>
                  <AppPinPad
                    value={pin}
                    onChange={setPin}
                    onComplete={(v) => handleSetPin(v)}
                    length={PIN_LENGTH}
                    errorTick={errorTick}
                    disabled={busy}
                    theme={padTheme}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {busy && mode !== 'password' && (
          <div className="flex items-center justify-center gap-2" style={{ color: colors.text.secondary }}>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs font-mono">
              {mode === 'setPinConfirm' ? 'Updating PIN…' : 'Unlocking…'}
            </span>
          </div>
        )}

        {/* Footer: mode-dependent links. Hidden during PIN-setup so the
            user doesn't bail mid-migration. */}
        {mode !== 'setPinEnter' && mode !== 'setPinConfirm' && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <div className="flex items-center gap-3">
              {mode === 'pin' && onMigrateToPin && (
                <button
                  onClick={() => { setMode('password'); resetError(); setPin(''); }}
                  className="text-[11px] font-mono transition-colors flex items-center gap-1"
                  style={{ color: colors.text.secondary }}
                >
                  <Key className="w-3 h-3" />
                  Use password
                </button>
              )}
              {mode === 'password' && (
                <button
                  onClick={() => { setMode('pin'); resetError(); setLegacyPassword(''); }}
                  className="text-[11px] font-mono transition-colors flex items-center gap-1"
                  style={{ color: colors.text.secondary }}
                >
                  <Check className="w-3 h-3" />
                  Use PIN
                </button>
              )}
              {onForgotPassword && (
                <button
                  onClick={onForgotPassword}
                  className="text-[11px] font-mono transition-colors flex items-center gap-1"
                  style={{ color: colors.text.tertiary }}
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
          </div>
        )}
      </motion.div>
    </div>
  );
}
