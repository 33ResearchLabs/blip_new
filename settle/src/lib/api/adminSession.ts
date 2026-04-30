/**
 * Client-side helpers for admin session — post cookie migration.
 *
 * BEFORE: admin token was stored in localStorage, read on every fetch,
 * attached as `Authorization: Bearer <token>` header. XSS-readable.
 *
 * AFTER: token lives in an httpOnly + Secure + SameSite=Strict cookie
 * issued by /api/auth/admin. JS cannot read it. fetch() sends it
 * automatically on same-origin requests (default `credentials: 'same-origin'`).
 *
 * Components keep using a string `adminToken` state to gate UI — but
 * post-migration the value is just this sentinel. The actual token is
 * never exposed to JS.
 */

import { fetchWithAuth } from './fetchWithAuth';

/**
 * Non-empty placeholder stored in component state where the real token
 * used to live. Treat as opaque — DO NOT send it as a header value.
 */
export const ADMIN_COOKIE_SENTINEL = '_cookie_session_';

/**
 * Probe the admin session.
 *
 * If a legacy localStorage token is present, it is sent ONCE as a
 * Bearer header so the server can migrate the session into a cookie,
 * then deleted. This branch can be removed ~25h after deploy.
 *
 * Returns:
 *   { valid: true, username }    — session live
 *   { valid: false }              — no session / expired / revoked
 */
export async function probeAdminSession(): Promise<{ valid: boolean; username?: string }> {
  let legacyToken: string | null = null;
  try {
    legacyToken = localStorage.getItem('blip_admin_token');
  } catch { /* SSR / disabled storage */ }

  const headers: Record<string, string> = {};
  if (legacyToken) headers.Authorization = `Bearer ${legacyToken}`;

  try {
    const res = await fetchWithAuth('/api/auth/admin', { headers });
    const data = await res.json();
    if (data?.success && data?.data?.valid) {
      // Migration succeeded (or wasn't needed). Drop the legacy copy.
      if (legacyToken) {
        try { localStorage.removeItem('blip_admin_token'); } catch { /* */ }
      }
      return { valid: true, username: data.data.username };
    }
  } catch {
    // Network error — caller decides what to do
  }
  // Always clear the legacy entry on a negative outcome to prevent it
  // from being reused on the next mount.
  try { localStorage.removeItem('blip_admin_token'); } catch { /* */ }
  return { valid: false };
}

/**
 * End the admin session: hits the server logout (which clears the cookie
 * and revokes the jti in Redis) and wipes any leftover localStorage.
 *
 * Always resolves — never throws. Logout must not be blocked by network
 * errors.
 */
export async function adminLogout(): Promise<void> {
  try {
    await fetchWithAuth('/api/auth/admin/logout', { method: 'POST' });
  } catch { /* ignore — local cleanup still proceeds */ }
  try {
    localStorage.removeItem('blip_admin');
    localStorage.removeItem('blip_admin_token');
  } catch { /* SSR */ }
}
