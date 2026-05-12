/**
 * Logout storage hygiene
 *
 * Centralizes which localStorage / sessionStorage keys must be cleared
 * when an actor logs out, so every logout site converges on the same
 * sweep instead of spot-removing one or two keys.
 *
 * Why this matters: prior to this helper, AppContext cleared only
 * `walletAddress`, MerchantNavbar cleared `blip_merchant` + `merchant_info`,
 * UserModals cleared `blip_user` + `blip_wallet`, etc. Stale auth/identity
 * keys from one path could survive a logout via another, which meant
 * residual user context was readable by the next account that opened the
 * same browser tab.
 *
 * Design rules:
 *
 *   1. CLEAR auth/identity state. Anything that the next-logged-in user
 *      could see, abuse, or be confused by — gone.
 *
 *   2. PRESERVE UX-only state. Theme, PWA install dismissal, "remember
 *      me" form prefill, notification sound prefs. Clearing these gives
 *      no security benefit and just annoys returning users.
 *
 *   3. PRESERVE encrypted blobs keyed by actorId. The user's encrypted
 *      wallet (`blip_embedded_wallet:<id>`) MUST survive logout — the
 *      same user logging back in needs to unlock it. It's already
 *      encrypted at rest, so nothing leaks by leaving it.
 *
 *   4. NEVER persist unlocked secrets across logout. The decrypted
 *      session key (`blip_wallet_session:<id>`) is the most sensitive
 *      thing in the app — wipe it on every logout, even if we don't
 *      know the actorId (use a prefix sweep).
 *
 * The helpers are deliberately conservative: failures in storage access
 * are swallowed so a partial clear cannot block the logout itself.
 */

/** localStorage keys that always represent auth/identity state and
 *  should be removed by every logout path. Per-actor namespaced keys
 *  are handled separately via prefix sweeps below. */
const ALWAYS_CLEAR_LOCAL_KEYS = [
  'blip_user',
  'blip_wallet',
  'walletAddress',
  'blip_merchant',
  'merchant_info',
  'blip_admin',
] as const;

/** sessionStorage keys that always represent auth/identity state. */
const ALWAYS_CLEAR_SESSION_KEYS = [
  'ops_admin_secret',
  'pending_compliance_wallet_login',
] as const;

/** localStorage prefixes that hold unlocked-only-in-memory material.
 *  These are namespaced by actorId. We sweep by prefix so a logout
 *  catches every previously-unlocked account on the same device, not
 *  only the one whose id we happen to know at the call site. */
const SESSION_SECRET_LOCAL_PREFIXES = [
  // Decrypted wallet keypair (bs58). MUST NOT survive any logout.
  'blip_wallet_session:',
] as const;

/** sessionStorage prefixes for "app unlocked this tab" flags. These
 *  gate the in-app PIN/biometric lock — must be reset so the next
 *  account is required to unlock from scratch. */
const SESSION_UNLOCK_FLAG_SESSION_PREFIXES = [
  'blip_app_unlocked:',
] as const;

function safeRemoveLocal(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* storage may be unavailable in some contexts; ignore */
  }
}

function safeRemoveSession(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function sweepPrefix(
  storage: Storage,
  prefixes: readonly string[],
  remove: (key: string) => void,
): void {
  try {
    const matched: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key) continue;
      if (prefixes.some((p) => key.startsWith(p))) matched.push(key);
    }
    // Two-pass remove so we don't mutate the iterator midway.
    matched.forEach(remove);
  } catch {
    /* ignore */
  }
}

/**
 * The shared sweep that every logout path runs unconditionally.
 *
 * Strips identity/auth keys and any unlocked-secret material, but
 * preserves encrypted blobs and UX preferences so returning users
 * land in the same place they left.
 */
export function clearAuthStorageOnLogout(): void {
  if (typeof window === 'undefined') return;

  for (const key of ALWAYS_CLEAR_LOCAL_KEYS) safeRemoveLocal(key);
  for (const key of ALWAYS_CLEAR_SESSION_KEYS) safeRemoveSession(key);

  // Sweep all unlocked-secret material across every namespaced actor.
  // Done as a prefix scan so a stale session from a prior account
  // (whose id the current code path doesn't know) is still cleared.
  sweepPrefix(window.localStorage, SESSION_SECRET_LOCAL_PREFIXES, safeRemoveLocal);
  sweepPrefix(window.sessionStorage, SESSION_UNLOCK_FLAG_SESSION_PREFIXES, safeRemoveSession);
}
