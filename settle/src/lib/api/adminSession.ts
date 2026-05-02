/**
 * Client-side helpers for admin session — cookie-only.
 *
 * The admin token lives in an httpOnly + Secure + SameSite=Strict cookie
 * (`blip_admin_session`) issued by /api/auth/admin. JS cannot read it.
 * fetch() sends it automatically on same-origin requests; cross-origin
 * requires `credentials: 'include'` (handled by fetchWithAuth).
 *
 * Components keep using a string `adminToken` state to gate UI — but the
 * value is now this sentinel. The actual token is never exposed to JS.
 *
 * The previous version of this module read a legacy `blip_admin_token`
 * from localStorage and sent it as a one-shot Bearer header so the server
 * could migrate the session into a cookie. That migration window has
 * closed; the legacy fallback is gone, and reading that key from
 * localStorage anywhere in the app is a regression.
 */

import { fetchWithAuth } from './fetchWithAuth';

/**
 * Non-empty placeholder stored in component state where the real token
 * used to live. Treat as opaque — DO NOT send it as a header value.
 */
export const ADMIN_COOKIE_SENTINEL = '_cookie_session_';

/**
 * Probe the admin session via /api/auth/admin.
 *
 * Cookie travels automatically (same-origin) — no headers are attached.
 *
 * Returns:
 *   { valid: true, username }    — session live
 *   { valid: false }              — no session / expired / revoked
 */
export async function probeAdminSession(): Promise<{ valid: boolean; username?: string }> {
  try {
    const res = await fetchWithAuth('/api/auth/admin');
    const data = await res.json();
    if (data?.success && data?.data?.valid) {
      return { valid: true, username: data.data.username };
    }
  } catch {
    // Network error — caller decides what to do
  }
  return { valid: false };
}

/**
 * End the admin session: hits the server logout (which clears the cookie
 * and revokes the jti in Redis).
 *
 * Always resolves — never throws. Logout must not be blocked by network
 * errors. The non-secret `blip_admin` profile blob (username/role for UI
 * display) is also dropped so the next login lands cleanly.
 */
export async function adminLogout(): Promise<void> {
  try {
    await fetchWithAuth('/api/auth/admin/logout', { method: 'POST' });
  } catch { /* ignore — local cleanup still proceeds */ }
  try {
    localStorage.removeItem('blip_admin');
  } catch { /* SSR */ }
}
