'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Lock, LogOut } from 'lucide-react';
import { AppPinPad } from './AppPinPad';
import { useAppLock } from '@/context/AppLockContext';
import { useUserTheme } from '@/hooks/useUserTheme';
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
  const { theme } = useUserTheme();
  const isLight = theme === 'light';

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

  // Clear the "Try again in Xs" error message once the cooldown expires.
  useEffect(() => {
    if (cooldownLeft === 0) setError('');
  }, [cooldownLeft]);

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
      className="fixed inset-0 z-[200] flex justify-center"
      // Transparent so the app's own frame (var(--user-frame), rendered
      // behind this overlay) shows through on the sides — the lock then
      // matches the app's frame colour on desktop without re-deriving the
      // theme here. The centred panel below (440px phone / 720px tablet,
      // matching the app frame) still covers all content.
      style={{ background: 'transparent' }}
      role="dialog"
      aria-modal="true"
      aria-label="App locked"
    >
      {/* App-width column — must mirror the app frame EXACTLY (page.tsx Panel:
          max-w-[440px] phone, md:max-w-[min(1100px,97vw)] ≥768px) so the lock
          fully covers the widened app content instead of leaking it on the
          sides (e.g. on a foldable). Keep these two in sync. On desktop the
          transparent outer shows the app-frame colour beside the panel. The
          frosted panel + blur live here; the inner PIN UI stays centred ~440. */}
      <div
        className="relative w-full max-w-[440px] md:max-w-[min(1100px,97vw)] flex items-start sm:items-center justify-center overflow-y-auto"
        style={{
          background: isLight ? 'rgba(248,250,252,0.96)' : 'rgba(6,6,6,0.96)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          paddingTop: 'max(env(safe-area-inset-top, 16px), 16px)',
          paddingBottom: 'max(env(safe-area-inset-bottom, 16px), 16px)',
          paddingLeft: 'max(env(safe-area-inset-left, 16px), 16px)',
          paddingRight: 'max(env(safe-area-inset-right, 16px), 16px)',
        }}
      >
        {/* Frosted panel bg spans the full app width (covers all content), but
            the PIN UI stays a comfortable ~440px centred so the keypad doesn't
            stretch on a 720px tablet panel. */}
        <div className="w-full max-w-[440px] mx-auto space-y-4 sm:space-y-6 my-auto">
        {/* Header */}
        <div className="flex flex-col items-center gap-2 sm:gap-3 pt-1 sm:pt-2">
          <div
            className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center"
            style={{
              background: isLight ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${isLight ? 'rgba(15,23,42,0.10)' : 'rgba(255,255,255,0.10)'}`,
            }}
          >
            <Lock
              className="w-5 h-5 sm:w-6 sm:h-6"
              style={{ color: isLight ? '#0f172a' : '#ffffff' }}
            />
          </div>
          <div className="text-center">
            <h2
              className="text-base sm:text-lg font-bold font-mono"
              style={{ color: isLight ? 'rgba(15,23,42,0.95)' : '#ffffff' }}
            >
              Welcome back
            </h2>
            <p
              className="text-[11px] sm:text-[12px] font-mono mt-1"
              style={{ color: isLight ? 'rgba(15,23,42,0.55)' : 'rgba(255,255,255,0.50)' }}
            >
              {lockedOut
                ? `Try again in ${cooldownLeft}s`
                : biometricEnrolled
                  ? 'Use biometrics or enter your PIN'
                  : 'Enter your PIN to continue'}
            </p>
          </div>
        </div>

        {error && (
          <div
            className="px-3 py-2 rounded-lg text-[11px] font-mono text-center"
            style={{
              background: isLight ? 'rgba(220,38,38,0.08)' : 'rgba(239,68,68,0.10)',
              border: `1px solid ${isLight ? 'rgba(220,38,38,0.20)' : 'rgba(239,68,68,0.20)'}`,
              color: isLight ? '#b91c1c' : '#f87171',
            }}
          >
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
          theme={theme}
        />

        {biometricRunning && (
          <div
            className="flex items-center justify-center gap-2 text-[11px] font-mono"
            style={{ color: isLight ? 'rgba(15,23,42,0.55)' : 'rgba(255,255,255,0.55)' }}
          >
            <Loader2 className="w-3 h-3 animate-spin" /> Waiting for biometrics…
          </div>
        )}

        {/* Escape hatch — logout from the lock screen */}
        <button
          type="button"
          onClick={doLogout}
          disabled={loggingOut}
          className="w-full py-2 rounded-lg text-[11px] font-mono disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors"
          style={{ color: isLight ? 'rgba(15,23,42,0.55)' : 'rgba(255,255,255,0.45)' }}
        >
          {loggingOut ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogOut className="w-3 h-3" />}
          {loggingOut ? 'Signing out…' : 'Sign out instead'}
        </button>
        </div>
      </div>
    </motion.div>
  );
}
