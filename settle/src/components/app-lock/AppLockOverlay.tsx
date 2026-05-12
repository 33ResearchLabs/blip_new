'use client';

import dynamic from 'next/dynamic';
import { useAppLock } from '@/context/AppLockContext';
import { BackgroundBlurOverlay } from './BackgroundBlurOverlay';

// Code-split the lock screen — it's a top-level overlay that pulls in
// framer-motion and the keypad, and most page loads won't need it
// (user not yet authed, or no PIN set). Loading 'null' avoids any
// flicker before the chunk lands.
const AppLockScreen = dynamic(
  () => import('./AppLockScreen').then((m) => m.AppLockScreen),
  { ssr: false, loading: () => null },
);

/** Top-level mount — render once inside the AppLockProvider. Surfaces
 *  the lock screen when state === 'locked' and the background-blur
 *  overlay when the tab is hidden. Both render outside the rest of the
 *  app tree so route changes never unmount them. */
export function AppLockOverlay() {
  const { state } = useAppLock();
  return (
    <>
      {state === 'locked' && <AppLockScreen />}
      <BackgroundBlurOverlay />
    </>
  );
}
