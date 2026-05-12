'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Lock, LogOut } from 'lucide-react';
import { AppPinPad } from './AppPinPad';
import { useAppLock } from '@/context/AppLockContext';
import {
  verifyAppPin,
  cooldownSecondsRemaining,
  APP_PIN_LENGTH,
  MAX_PIN_FAILURES,
} from '@/lib/auth/appPin';
import {
  assertBiometric,
  hasBiometricEnrolled,
  isBiometricSupported,
  clearBiometricTrust,
} from '@/lib/auth/appBiometric';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

/** Full-viewport lock screen rendered as a global overlay whenever the
 *  app-lock state is "locked". Auto-attempts biometric on mount; the
 *  PIN pad is always available as a fallback. */
export function AppLockScreen() {
  const { userId, markUnlocked, clearForCurrentUser } = useAppLock();

  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [errorTick, setErrorTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [biometricRunning, setBiometricRunning] = useState(false);
  const [biometricSupported, setBiometricSupportedState] = useState(false);
  const [biometricEnrolled, setBiometricEnrolledState] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const autoTriedRef = useRef(false);

  // Probe biometric capability once. Then check whether THIS user has
  // an enrolled credential. SSR-safe — both checks branch on window.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await isBiometricSupported();
      if (!cancelled) setBiometricSupportedState(ok);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setBiometricEnrolledState(hasBiometricEnrolled(userId));
  }, [userId]);

  // Cooldown countdown ticker. Runs only while the user is locked out
  // for a cooldown window; idles otherwise so the component is cheap
  // when not in a failure state.
  useEffect(() => {
    if (!userId) return;
    const tick = () => setCooldownLeft(cooldownSecondsRemaining(userId));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [userId, errorTick]);

  const tryBiometric = async () => {
    if (!userId || biometricRunning || busy) return;
    setBiometricRunning(true);
    setError('');
    try {
      const assertion = await assertBiometric(userId);
      if (!assertion.ok || !assertion.pin) {
        // Cancel / fail: silently fall back to the PIN pad. The user
        // can re-tap the fingerprint button.
        return;
      }
      const v = await verifyAppPin(userId, assertion.pin);
      if (v.ok) {
        markUnlocked();
        return;
      }
      // Wrapped PIN no longer verifies — the user changed/cleared the
      // PIN after enrolling. Drop the stale trust and ask for PIN.
      clearBiometricTrust(userId);
      setBiometricEnrolledState(false);
      flashError('Biometric is out of date — enter PIN to refresh it.');
    } finally {
      setBiometricRunning(false);
    }
  };

  // Auto-prompt biometric once on mount when enrolled. The user always
  // has the explicit button below for retry, and cooldown / wipe states
  // short-circuit the auto-prompt.
  useEffect(() => {
    if (!biometricSupported || !biometricEnrolled) return;
    if (autoTriedRef.current) return;
    if (cooldownLeft > 0) return;
    autoTriedRef.current = true;
    tryBiometric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biometricSupported, biometricEnrolled]);

  const flashError = (msg: string) => {
    setError(msg);
    setErrorTick((n) => n + 1);
    setPin('');
  };

  const handleComplete = async (entered: string) => {
    if (!userId) return;
    setBusy(true);
    setError('');
    try {
      const res = await verifyAppPin(userId, entered);
      if (res.ok) {
        markUnlocked();
        return;
      }
      if (res.wiped) {
        // Hard wipe: PIN cleared. Force a logout — the user will set a
        // new PIN after re-login. This avoids leaving them on an
        // unrecoverable lock screen with no PIN to enter.
        flashError('Too many wrong tries. PIN cleared. Logging you out…');
        await doLogout();
        return;
      }
      if (res.cooldownSeconds > 0) {
        flashError(`Too many wrong tries. Try again in ${res.cooldownSeconds}s.`);
        return;
      }
      const left = MAX_PIN_FAILURES - res.failures;
      flashError(left <= 3 ? `Wrong PIN — ${left} ${left === 1 ? 'try' : 'tries'} left` : 'Wrong PIN');
    } finally {
      setBusy(false);
    }
  };

  const doLogout = async () => {
    setLoggingOut(true);
    try {
      await fetchWithAuth('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => null);
    } finally {
      // Clear PIN state for this device + the actor mapping. The lock
      // screen will fall back to /api/auth/me on next mount and route
      // to the login page since there's no actor.
      clearForCurrentUser();
      if (typeof window !== 'undefined') window.location.href = '/';
    }
  };

  const lockedOut = cooldownLeft > 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: 'rgba(6,6,6,0.96)', backdropFilter: 'blur(20px)' }}
      role="dialog"
      aria-modal="true"
      aria-label="App locked"
    >
      <div className="w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="flex flex-col items-center gap-3 pt-2">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-accent/15 border border-accent/30">
            <Lock className="w-6 h-6 text-accent" />
          </div>
          <div className="text-center">
            <h2 className="text-lg font-bold text-white font-mono">Welcome back</h2>
            <p className="text-[12px] text-white/50 font-mono mt-1">
              {lockedOut
                ? `Try again in ${cooldownLeft}s`
                : biometricEnrolled
                  ? 'Use biometrics or enter your PIN'
                  : 'Enter your PIN to continue'}
            </p>
          </div>
        </div>

        {error && (
          <div className="px-3 py-2 rounded-lg text-[11px] font-mono text-center bg-red-500/10 border border-red-500/20 text-red-400">
            {error}
          </div>
        )}

        <AppPinPad
          value={pin}
          onChange={(v) => { setPin(v); if (error && !lockedOut) setError(''); }}
          onComplete={handleComplete}
          length={APP_PIN_LENGTH}
          errorTick={errorTick}
          disabled={busy || biometricRunning || lockedOut || loggingOut}
          onBiometric={tryBiometric}
          showBiometric={biometricSupported && biometricEnrolled}
        />

        {biometricRunning && (
          <div className="flex items-center justify-center gap-2 text-[11px] text-white/55 font-mono">
            <Loader2 className="w-3 h-3 animate-spin" /> Waiting for biometrics…
          </div>
        )}

        {/* Escape hatch — logout from the lock screen */}
        <button
          type="button"
          onClick={doLogout}
          disabled={loggingOut}
          className="w-full py-2 rounded-lg text-[11px] text-white/45 font-mono hover:text-white/70 hover:bg-white/[0.03] disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {loggingOut ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogOut className="w-3 h-3" />}
          {loggingOut ? 'Signing out…' : 'Sign out instead'}
        </button>
      </div>
    </motion.div>
  );
}
