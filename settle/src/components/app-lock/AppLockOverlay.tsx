'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
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

// Each actor's lock belongs to its OWN app surface: a user's lock only
// inside the user app (/user), a merchant's lock only on the merchant app
// (/market), compliance only under /compliance. Without this scope the
// globally-mounted overlay paints the lock screen over the public marketing
// landing ('/') — and over the other app — whenever a returning,
// PIN-protected session is still valid but the route hasn't entered (or
// hasn't forwarded into) that actor's own app yet.
const SURFACE_FOR_ACTOR: Record<string, RegExp> = {
  user: /^\/user(\/|$)/,
  merchant: /^\/market(\/|$)/,
  compliance: /^\/compliance(\/|$)/,
};

/** Top-level mount — render once inside the AppLockProvider. Surfaces
 *  the lock screen when state === 'locked' AND the current route is the
 *  locked actor's own app surface, plus the background-blur overlay when
 *  the tab is hidden. Both render outside the rest of the app tree so
 *  route changes never unmount them. */
export function AppLockOverlay() {
  const { state, actorType } = useAppLock();
  const pathname = usePathname() ?? '';
  const onOwnSurface =
    !!actorType && (SURFACE_FOR_ACTOR[actorType]?.test(pathname) ?? false);
  return (
    <>
      {onOwnSurface && state === 'locked' && <AppLockScreen />}
      <BackgroundBlurOverlay />
    </>
  );
}
