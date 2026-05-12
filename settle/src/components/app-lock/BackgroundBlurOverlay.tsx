'use client';

import { Lock } from 'lucide-react';
import { useAppLock } from '@/context/AppLockContext';

/** When the document is hidden (the OS / browser is showing the app
 *  switcher, the user tabbed away, or the screen is off), render an
 *  opaque + blurred overlay so the snapshot the OS captures for the
 *  app-switcher preview does NOT show any account balances or trade
 *  details. The overlay is rendered globally so it applies to every
 *  route — user / merchant / compliance / settings alike.
 *
 *  We render this only when the user has an App PIN set; otherwise the
 *  user opted out of the security lock and we leave the UI alone. */
export function BackgroundBlurOverlay() {
  const { isBackgrounded, state } = useAppLock();
  // No PIN → user hasn't opted into the lock; honor that for the blur
  // too. Initializing state is treated the same way to avoid a flash
  // on first mount before /api/auth/me resolves.
  const enabled = state === 'unlocked' || state === 'locked';
  if (!enabled || !isBackgrounded) return null;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[180] flex items-center justify-center pointer-events-none"
      style={{ background: 'rgba(6,6,6,0.92)', backdropFilter: 'blur(24px)' }}
    >
      <div className="flex flex-col items-center gap-2">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-white/[0.05]">
          <Lock className="w-6 h-6 text-white/70" />
        </div>
        <span className="text-[12px] font-bold text-white/70 font-mono tracking-wider">BLIP</span>
      </div>
    </div>
  );
}
