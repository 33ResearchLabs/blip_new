'use client';

/**
 * App-Level Security Lock provider.
 *
 * Responsibilities:
 *  1. Probe the authenticated actor (user / merchant / compliance) so
 *     lock state is per-account. Logout / account switch picks up via
 *     `setUserId(null)`.
 *  2. Track lock state — none (no PIN set), locked, unlocked.
 *  3. Auto-lock on app restart, on visibility-hidden (configurable
 *     grace period before re-lock), and on inactivity timeout.
 *  4. Expose lock() / unlock() / refresh() and the cached userId.
 *
 * Out of scope (explicitly):
 *  - Wallet locking. The embedded wallet has its own auto-lock and we
 *    do not touch it.
 *  - Backend session lifecycle. The auth token / refresh-cookie flow is
 *    unchanged; the App Lock is a UI-side gate only.
 *  - Merchant/user isolation. The lock is keyed by the actor's id, so
 *    merchants and users on the same device do not share lock state.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { hasAppPin, isSessionUnlocked, markSessionUnlocked, clearSessionUnlock, clearAppPin } from '@/lib/auth/appPin';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

export type AppLockState =
  | 'initializing'  // probing auth + PIN status
  | 'no-pin'        // no PIN set for this user; UI should not render the lock
  | 'unlocked'      // PIN set + currently unlocked
  | 'locked';       // PIN set + needs unlock

// Background grace period: app stays unlocked for this long when the
// tab becomes hidden, so quick tab-switches don't force a re-prompt.
// Longer hides re-lock on visibility return.
const BACKGROUND_GRACE_MS = 5_000;

// Inactivity auto-lock: no user input for this long while visible
// triggers a lock. Matches typical fintech app behavior.
const INACTIVITY_LOCK_MS = 5 * 60 * 1000;

interface AppLockContextValue {
  state: AppLockState;
  userId: string | null;
  /** Whether the device shows the background-blur overlay (tab hidden). */
  isBackgrounded: boolean;
  /** Force a re-lock (e.g. from "Lock now" in settings). */
  lock: () => void;
  /** Mark unlocked after a successful PIN/biometric verify. */
  markUnlocked: () => void;
  /** Auth flows call this with the active actor id on login, and `null`
   *  on logout. Lock state recomputes off the new id. */
  setUserId: (id: string | null) => void;
  /** Re-probe PIN status (e.g. after the user just set a PIN). */
  refreshPinStatus: () => void;
  /** Clear EVERYTHING for the current user — used by "Remove PIN" /
   *  failure-wipe paths. Caller is responsible for re-routing the user. */
  clearForCurrentUser: () => void;
}

const AppLockContext = createContext<AppLockContextValue | null>(null);

export function useAppLock(): AppLockContextValue {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error('useAppLock must be used within AppLockProvider');
  return ctx;
}

/** Read-only convenience: returns true when the app-lock UI should be
 *  rendered as an overlay (state === 'locked'). Cheap, common case. */
export function useIsAppLocked(): boolean {
  return useAppLock().state === 'locked';
}

export function AppLockProvider({ children }: { children: ReactNode }) {
  const [userId, setUserIdState] = useState<string | null>(null);
  const [state, setState] = useState<AppLockState>('initializing');
  const [isBackgrounded, setIsBackgrounded] = useState(false);
  // Initialized to 0; first activity event (or unlock) writes the
  // current time. Date.now() can't run in the render body — the
  // react-hooks/purity rule guards against that — so we use a lazy
  // sentinel and let the inactivity timer treat 0 as "no recent
  // activity recorded yet" (which the unlock path always overwrites
  // before the timer starts running).
  const lastActivityRef = useRef<number>(0);
  const backgroundedAtRef = useRef<number | null>(null);
  const inactivityTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ----- compute lock state for the current user -----

  const computeStateFor = useCallback((id: string | null): AppLockState => {
    if (!id) return 'no-pin';
    if (!hasAppPin(id)) return 'no-pin';
    if (isSessionUnlocked(id)) return 'unlocked';
    return 'locked';
  }, []);

  const setUserId = useCallback((id: string | null) => {
    setUserIdState((prev) => {
      if (prev === id) return prev;
      // When the actor changes, drop any cached unlock flag for the
      // OLD actor — otherwise a second user on the same device might
      // inherit the first one's unlocked session by browser timing.
      if (prev) clearSessionUnlock(prev);
      return id;
    });
  }, []);

  // Initial probe: who's logged in right now? Uses the same /api/auth/me
  // endpoint that the user + merchant + compliance shells already use,
  // so we don't add a second source of truth for identity.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth('/api/auth/me', {
          method: 'GET',
          credentials: 'include',
        });
        if (cancelled) return;
        if (!res.ok) {
          setUserIdState(null);
          setState('no-pin');
          return;
        }
        const data = await res.json();
        // The actor id is at data.data.user.id / merchant.id / compliance.id
        // depending on actorType. We treat them uniformly here — the lock
        // is per-account regardless of role.
        const actorType = data?.data?.actorType;
        const id =
          actorType === 'user'       ? data?.data?.user?.id ?? null
          : actorType === 'merchant' ? data?.data?.merchant?.id ?? null
          : actorType === 'compliance' ? data?.data?.compliance?.id ?? null
          : null;
        setUserIdState(id);
      } catch {
        if (!cancelled) setUserIdState(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Recompute state whenever the actor changes. App boot ALWAYS lands
  // in 'locked' if the user has a PIN, because the session-unlock flag
  // lives in sessionStorage (cleared on app close).
  useEffect(() => {
    setState(computeStateFor(userId));
  }, [userId, computeStateFor]);

  const refreshPinStatus = useCallback(() => {
    setState(computeStateFor(userId));
  }, [userId, computeStateFor]);

  // ----- unlock / lock verbs -----

  const markUnlocked = useCallback(() => {
    if (!userId) return;
    markSessionUnlocked(userId);
    lastActivityRef.current = Date.now();
    setState('unlocked');
  }, [userId]);

  const lock = useCallback(() => {
    if (!userId) return;
    clearSessionUnlock(userId);
    setState((prev) => (prev === 'no-pin' ? prev : 'locked'));
  }, [userId]);

  const clearForCurrentUser = useCallback(() => {
    if (!userId) return;
    clearAppPin(userId);
    setState('no-pin');
  }, [userId]);

  // ----- visibility-driven background lock -----

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => {
      const hidden = document.visibilityState === 'hidden';
      setIsBackgrounded(hidden);
      if (hidden) {
        backgroundedAtRef.current = Date.now();
      } else {
        // Returning from background: if we were hidden long enough,
        // force a re-lock. Short tab-switches stay unlocked so quick
        // app-switcher peeks don't constantly demand the PIN.
        const at = backgroundedAtRef.current ?? 0;
        backgroundedAtRef.current = null;
        if (state !== 'no-pin' && Date.now() - at >= BACKGROUND_GRACE_MS) {
          lock();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [state, lock]);

  // ----- inactivity auto-lock -----

  useEffect(() => {
    if (state !== 'unlocked') return;
    // Seed on entry — the ref is initialized lazily to 0 (purity rule
    // forbids Date.now() in the render body) so we set the baseline
    // here, before the timer can fire.
    lastActivityRef.current = Date.now();
    const touch = () => { lastActivityRef.current = Date.now(); };
    const evts: Array<keyof DocumentEventMap> = ['pointerdown', 'keydown', 'touchstart'];
    evts.forEach((e) => document.addEventListener(e, touch, { passive: true }));
    inactivityTimerRef.current = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= INACTIVITY_LOCK_MS) lock();
    }, 30_000);
    return () => {
      evts.forEach((e) => document.removeEventListener(e, touch));
      if (inactivityTimerRef.current) clearInterval(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    };
  }, [state, lock]);

  // ----- cross-tab logout sync -----

  // When another tab clears the actor's PIN or session-unlock flag,
  // pick up the change so the user isn't stranded unlocked here while
  // they signed out over there.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = () => {
      setState(computeStateFor(userId));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [userId, computeStateFor]);

  const value: AppLockContextValue = {
    state,
    userId,
    isBackgrounded,
    lock,
    markUnlocked,
    setUserId,
    refreshPinStatus,
    clearForCurrentUser,
  };

  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}
