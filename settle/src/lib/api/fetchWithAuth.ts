/**
 * fetchWithAuth — drop-in replacement for fetch() that injects identity headers
 * and transparently refreshes expired access tokens.
 *
 * Auth strategy:
 *   1. If a signed session token exists → sends Authorization: Bearer <token>
 *   2. ALWAYS sends legacy x-merchant-id / x-user-id headers as fallback
 *   3. On 401 → attempts ONE silent refresh via /api/auth/refresh
 *   4. If refresh succeeds → retries original request with new token
 *   5. If refresh fails → clears token (caller handles logout)
 *
 * Usage:  import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
 *         const res = await fetchWithAuth('/api/merchant/orders?...');
 */

import { useMerchantStore } from '@/stores/merchantStore';

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};

  // 0. Session token — cryptographically signed, preferred auth method
  let sessionToken = useMerchantStore.getState().sessionToken;
  // Fallback: if store hasn't hydrated yet, check sessionStorage directly
  if (!sessionToken) {
    try {
      sessionToken = sessionStorage.getItem('blip_session_token');
    } catch {
      // SSR — skip
    }
  }
  if (sessionToken) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }

  // 1. Try Zustand store first (in-memory, most reliable)
  const merchantId = useMerchantStore.getState().merchantId;
  if (merchantId) {
    headers['x-merchant-id'] = merchantId;
  }

  // 2. Fallback to localStorage if store is empty
  if (!merchantId) {
    try {
      const saved = localStorage.getItem('blip_merchant');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.id) {
          headers['x-merchant-id'] = parsed.id;
        }
      }
    } catch {
      // localStorage not available (SSR) or corrupt — skip
    }
  }

  // 3. User ID from localStorage (user-facing app)
  // Always send x-user-id when available — the server disambiguates
  // using the route path (/merchant routes → merchant actor, else → user).
  // Both headers must be present so users logged into merchant + user
  // in the same browser can still create orders from the user side.
  try {
    const saved = localStorage.getItem('blip_user');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed?.id) {
        headers['x-user-id'] = parsed.id;
      }
    }
  } catch {
    // SSR or corrupt — skip
  }

  // 4. Compliance officer ID from localStorage
  try {
    const saved = localStorage.getItem('compliance_member');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed?.id) {
        headers['x-compliance-id'] = parsed.id;
      }
    }
  } catch {
    // SSR or corrupt — skip
  }

  // 5. Device fingerprint — cached in sessionStorage after first compute
  try {
    const cached = sessionStorage.getItem('blip_device_id');
    if (cached) {
      headers['x-device-id'] = cached;
      const meta = sessionStorage.getItem('blip_device_meta');
      if (meta) headers['x-device-meta'] = meta;
    }
  } catch {
    // SSR — skip
  }

  return headers;
}

/**
 * Compute device fingerprint and cache it in sessionStorage.
 * Called once on app load — async but non-blocking.
 */
let _deviceInitialized = false;
async function initDeviceFingerprint(): Promise<void> {
  if (_deviceInitialized) return;
  _deviceInitialized = true;
  try {
    if (typeof window === 'undefined') return;
    // Skip if already cached
    if (sessionStorage.getItem('blip_device_id')) return;
    const { getDeviceInfo } = await import('@/lib/device/fingerprint');
    const { deviceId, metadata } = await getDeviceInfo();
    sessionStorage.setItem('blip_device_id', deviceId);
    sessionStorage.setItem('blip_device_meta', JSON.stringify(metadata));
  } catch {
    // Non-critical — tracking will work without it
  }
}

/**
 * Generate a unique idempotency key for financial mutations.
 * Required by the backend for payment_sent, completed, cancelled transitions.
 */
export function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── In-flight request deduplication for GET requests ──────────────────
const inflightGets = new Map<string, Promise<Response>>();

// ── Token refresh coalescing ─────────────────────────────────────────
// If multiple requests 401 simultaneously, only ONE refresh call is made.
// All waiting requests share the same refresh promise.
let refreshPromise: Promise<string | null> | null = null;

/**
 * Attempt to refresh the access token using the httpOnly refresh cookie.
 * Returns the new access token or null if refresh failed.
 * Coalesces concurrent calls into a single network request.
 */
async function refreshAccessToken(): Promise<string | null> {
  // If a refresh is already in-flight, piggyback on it
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin', // sends httpOnly cookies
      });

      if (!res.ok) {
        // Refresh failed — token expired or revoked
        useMerchantStore.getState().setSessionToken(null);
        return null;
      }

      const data = await res.json();
      if (data.success && data.data?.accessToken) {
        useMerchantStore.getState().setSessionToken(data.data.accessToken);
        return data.data.accessToken as string;
      }

      useMerchantStore.getState().setSessionToken(null);
      return null;
    } catch {
      // Network error during refresh
      return null;
    } finally {
      // Clear coalescing lock after a short delay
      // (allow concurrent 401s to see the result before clearing)
      setTimeout(() => { refreshPromise = null; }, 100);
    }
  })();

  return refreshPromise;
}

// Auth routes should never trigger refresh (prevents infinite loops)
const NO_REFRESH_PATHS = ['/api/auth/refresh', '/api/auth/merchant', '/api/auth/user', '/api/auth/compliance', '/api/auth/admin'];

function shouldAttemptRefresh(url: string): boolean {
  return !NO_REFRESH_PATHS.some(path => url.includes(path));
}

// Routes where a 401 is normal (login attempt) and should NOT trigger a forced logout
const NO_FORCED_LOGOUT_PATHS = [
  '/api/auth/refresh',
  '/api/auth/merchant',
  '/api/auth/user',
  '/api/auth/compliance',
  '/api/auth/admin',
  '/api/auth/wallet',
  '/api/2fa/verify-login',
];

function shouldForceLogoutOn401(url: string): boolean {
  return !NO_FORCED_LOGOUT_PATHS.some(path => url.includes(path));
}

// Coalesce concurrent forced-logout calls so we wipe state + redirect once
let forcedLogoutInProgress = false;

/**
 * Hard logout: wipe all client-side auth state and redirect to the appropriate
 * login page. Called when the server says our session is no longer valid
 * (401 after a failed refresh) — we MUST stop using the dead token.
 */
function forceLogoutAndRedirect(): void {
  if (forcedLogoutInProgress) return;
  forcedLogoutInProgress = true;
  if (typeof window === 'undefined') return;

  try {
    // Wipe Zustand store (sessionToken, merchantId, merchantInfo)
    useMerchantStore.getState().setSessionToken(null);
    const setMerchantId = (useMerchantStore.getState() as any).setMerchantId;
    const setMerchantInfo = (useMerchantStore.getState() as any).setMerchantInfo;
    if (typeof setMerchantId === 'function') setMerchantId(null);
    if (typeof setMerchantInfo === 'function') setMerchantInfo(null);
  } catch { /* store not hydrated — ignore */ }

  try {
    sessionStorage.removeItem('blip_session_token');
    localStorage.removeItem('blip_merchant');
    localStorage.removeItem('merchant_info');
    localStorage.removeItem('blip_user');
    localStorage.removeItem('compliance_member');
  } catch { /* SSR — ignore */ }

  // Pick the right login page based on where the user currently is
  const path = window.location.pathname;
  let target = '/';
  if (path.startsWith('/merchant')) target = '/merchant?session=expired';
  else if (path.startsWith('/admin')) target = '/admin?session=expired';
  else if (path.startsWith('/compliance')) target = '/compliance?session=expired';
  else target = '/?session=expired';

  // Use replace so the dead-token page can't be reached via Back button
  window.location.replace(target);
}

/**
 * Drop-in replacement for window.fetch with auth headers injected.
 * Signature matches fetch() exactly.
 *
 * - GET requests are automatically deduplicated
 * - 401 responses trigger transparent token refresh + retry (once)
 * - Auth routes are excluded from refresh to prevent loops
 */
export function fetchWithAuth(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  // Lazily init device fingerprint (non-blocking, runs once)
  initDeviceFingerprint().catch(() => {});

  const method = (init?.method || 'GET').toUpperCase();
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  // GET deduplication
  if (method === 'GET') {
    const existing = inflightGets.get(url);
    if (existing) return existing.then(res => res.clone());

    const promise = executeWithRefresh(input, init, url).finally(() => {
      inflightGets.delete(url);
    });

    inflightGets.set(url, promise);
    return promise.then(res => res.clone());
  }

  return executeWithRefresh(input, init, url);
}

/**
 * Execute a fetch with auth headers. If the response is 401 and the URL
 * is not an auth route, attempt ONE token refresh and retry.
 */
async function executeWithRefresh(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  url: string,
): Promise<Response> {
  const authHeaders = getAuthHeaders();

  const response = await fetch(input, {
    ...init,
    headers: {
      ...authHeaders,
      ...init?.headers,
    },
  });

  // If not 401, or if this is an auth route, return as-is
  if (response.status !== 401 || !shouldAttemptRefresh(url)) {
    return response;
  }

  // Only attempt refresh if we had a token (otherwise 401 is expected — not logged in)
  const hadToken = !!authHeaders['Authorization'];
  if (!hadToken) return response;

  // Attempt silent refresh
  const newToken = await refreshAccessToken();
  if (!newToken) {
    // Refresh failed — server has rejected the session entirely.
    // Wipe local auth state and force the user to log in again.
    if (shouldForceLogoutOn401(url)) {
      forceLogoutAndRedirect();
    }
    return response;
  }

  // Retry with new token
  const retryHeaders = getAuthHeaders(); // re-read (now has new token)
  const retryResponse = await fetch(input, {
    ...init,
    headers: {
      ...retryHeaders,
      ...init?.headers,
    },
  });

  // If the retry STILL returned 401, the new access token is also being
  // rejected — the session was revoked between refresh and retry. Force logout.
  if (retryResponse.status === 401 && shouldForceLogoutOn401(url)) {
    forceLogoutAndRedirect();
  }

  return retryResponse;
}
