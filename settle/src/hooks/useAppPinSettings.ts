'use client';

import { useCallback, useEffect, useState } from 'react';
import { hasAppPin, appPinFailureCount, MAX_PIN_FAILURES } from '@/lib/auth/appPin';
import {
  hasBiometricEnrolled,
  isBiometricSupported,
  clearBiometricTrust,
} from '@/lib/auth/appBiometric';

/** Settings-side read state for the App PIN + biometric pair.
 *  Mutation verbs (set / verify / change / clear) come from the modules
 *  directly so the caller drives its own flow without coupling to this
 *  hook's lifecycle. */
export function useAppPinSettings(userId: string | null | undefined) {
  const [pinEnrolled, setPinEnrolled] = useState(false);
  const [biometricSupported, setBiometricSupportedState] = useState(false);
  const [biometricEnrolled, setBiometricEnrolledState] = useState(false);

  // Probe biometric support once. The internal helper caches the
  // result for the page lifetime so this is cheap on re-renders.
  useEffect(() => {
    let cancelled = false;
    isBiometricSupported().then((ok) => {
      if (!cancelled) setBiometricSupportedState(ok);
    });
    return () => { cancelled = true; };
  }, []);

  // Re-read storage when the user changes. Storage events from other
  // tabs would also propagate here via the AppLockContext listener.
  useEffect(() => {
    setPinEnrolled(hasAppPin(userId));
    setBiometricEnrolledState(hasBiometricEnrolled(userId));
  }, [userId]);

  const refresh = useCallback(() => {
    setPinEnrolled(hasAppPin(userId));
    setBiometricEnrolledState(hasBiometricEnrolled(userId));
  }, [userId]);

  const disableBiometric = useCallback(() => {
    clearBiometricTrust(userId);
    setBiometricEnrolledState(false);
  }, [userId]);

  return {
    pinEnrolled,
    biometricSupported,
    biometricEnrolled,
    pinFailures: appPinFailureCount(userId),
    maxPinFailures: MAX_PIN_FAILURES,
    refresh,
    disableBiometric,
  };
}
