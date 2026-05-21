// Client-only cache of which actor type owns the active waitlist session.
//
// Sessions are server-issued cookies — once they expire, the browser has no
// way to tell whether the stale cookie belonged to a user or a merchant, so
// it can't pick the right login page to redirect to. We solve that by
// stamping the actor type in localStorage on successful sign-in / register
// and reading it back when we hit a 401.

const KEY = 'blip_waitlist_actor_type';
export type WaitlistRole = 'user' | 'merchant';

export function rememberRole(role: WaitlistRole): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(KEY, role); } catch {/* storage full / disabled */}
}

export function forgetRole(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(KEY); } catch {/* ignore */}
}

export function readRole(): WaitlistRole | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'merchant' || v === 'user' ? v : null;
  } catch { return null; }
}

/**
 * Where should an expired-session redirect land?
 *   - merchant session → /waitlist/merchant-login
 *   - user session     → /waitlist/login
 *   - unknown          → /waitlist/login (safe default — symmetric flow is
 *                        reachable via the bottom cross-link)
 */
export function loginPathForRole(role: WaitlistRole | null): string {
  return role === 'merchant' ? '/waitlist/merchant-login' : '/waitlist/login';
}
