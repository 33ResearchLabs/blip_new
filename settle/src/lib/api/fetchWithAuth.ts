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

  // Pick the right login page based on where the user currently is.
  // Drop on the dedicated login form (not the welcome page) with a reason
  // query param so the UI can show "Session expired — please sign in" banner.
  const path = window.location.pathname;
  let target = '/login?reason=session_expired';
  if (path.startsWith('/merchant')) target = '/merchant/login?reason=session_expired';
  else if (path.startsWith('/admin')) target = '/admin?session=expired';
  else if (path.startsWith('/compliance')) target = '/compliance?session=expired';

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

// ── Automatic API failure logging ─────────────────────────────────────
// Every 4xx/5xx response goes through here. Zero-cost when the feature
// flag is off: `logClientError` itself checks NEXT_PUBLIC_ENABLE_ERROR_TRACKING
// and returns immediately if disabled.

// Certain 401s are "expected": login attempts, check_session probes, etc.
// These are normal user flow, not failures worth tracking.
const EXPECTED_401_PATHS = [
  '/api/auth/refresh',
  '/api/auth/merchant',
  '/api/auth/user',
  '/api/auth/wallet',
  '/api/auth/compliance',
  '/api/auth/admin',
  '/api/2fa/verify-login',
];

function isExpected401(status: number, url: string): boolean {
  if (status !== 401) return false;
  return EXPECTED_401_PATHS.some((p) => url.includes(p));
}

/**
 * 404s on a single-resource GET are usually "item was deleted / moved /
 * never existed" — not bugs, just UX reality. We still log 404s on other
 * endpoints (they likely indicate a routing bug).
 */
const EXPECTED_404_PATTERNS = [
  /^\/api\/orders\/[^/?]+($|\?)/,        // GET single order by id
  /^\/api\/orders\/[^/]+\/receipt/,
  /^\/api\/orders\/[^/]+\/extension/,
  /^\/api\/disputes\/[^/]+$/,
];

function isExpected404(status: number, url: string): boolean {
  if (status !== 404) return false;
  const path = extractPath(url);
  return EXPECTED_404_PATTERNS.some((re) => re.test(path));
}

// Certain 400s are "expected" business-rule violations, not bugs.
// Examples: rating an order twice, requesting an extension after max,
// double-clicking an action that's already in progress.
// These are correct backend behavior — the API is doing its job — and
// shouldn't pollute the error log dashboard.
const EXPECTED_400_API_ERROR_PATTERNS = [
  /already rated/i,
  /already (cancel|extend|accept|claim|dispute)/i,
  /already (a |an )?merchant/i,
  /already (in |a )/i, // "already in progress", "already a participant"
  /no .* pending/i, // "No extension request pending"
  /cannot respond to own/i,
  /max(imum)? extensions reached/i,
  /maximum allowed/i,
];

function isExpected400(status: number, bodyText: string | undefined): boolean {
  if (status !== 400) return false;
  if (!bodyText) return false;
  try {
    const parsed = JSON.parse(bodyText);
    const msg = String(parsed?.error || '');
    const details: string[] = Array.isArray(parsed?.details) ? parsed.details : [];
    const allText = [msg, ...details].join(' ');
    return EXPECTED_400_API_ERROR_PATTERNS.some((re) => re.test(allText));
  } catch {
    return false;
  }
}

async function logApiFailure(
  url: string,
  method: string,
  status: number,
  bodyText?: string,
): Promise<void> {
  // Lazy import so the tracking code stays out of the hot path until needed
  try {
    if (isExpected401(status, url)) return;
    if (isExpected400(status, bodyText)) return;
    if (isExpected404(status, url)) return;
    const { logClientError } = await import('@/lib/errorTracking/clientLogger');
    const severity: 'WARN' | 'ERROR' | 'CRITICAL' =
      status >= 500 ? 'ERROR' : status === 429 ? 'WARN' : 'WARN';
    const type =
      status >= 500
        ? 'ui.api_fail.5xx'
        : status === 429
          ? 'ui.api_fail.rate_limited'
          : status === 403
            ? 'ui.api_fail.forbidden'
            : status === 401
              ? 'ui.api_fail.unauthorized'
              : status === 404
                ? 'ui.api_fail.not_found'
                : 'ui.api_fail.client_error';

    // Extract a human-readable error message if the body is JSON
    let apiError: string | undefined;
    if (bodyText) {
      try {
        const parsed = JSON.parse(bodyText);
        if (typeof parsed?.error === 'string') apiError = parsed.error;
      } catch { /* not JSON — treat as opaque */ }
    }

    logClientError({
      type,
      severity,
      message: `${method} ${extractPath(url)} → ${status}${apiError ? ` · ${apiError}` : ''}`,
      metadata: {
        url,
        method,
        status,
        apiError,
        responseBodyPreview: bodyText ? bodyText.slice(0, 500) : undefined,
      },
    });
  } catch { /* swallow */ }
}

/**
 * Paths where a network abort/fetch-failed error is EXPECTED (not a bug):
 *  - Heartbeat endpoints fire on a timer; page unload will abort in-flight ones.
 *  - These aborts pollute the error log with hundreds of false alarms.
 * Logging at severity='ERROR' for these is misleading, so we skip them.
 */
const EXPECTED_NETWORK_ABORT_PATHS = [
  '/api/presence/heartbeat',
  '/api/heartbeat',
];

function isExpectedNetworkAbort(url: string, err: unknown): boolean {
  const path = extractPath(url);
  if (EXPECTED_NETWORK_ABORT_PATHS.some((p) => path.includes(p))) return true;
  // User-initiated abort (page navigation, AbortController) — normal browser behavior
  if (err instanceof Error && err.name === 'AbortError') return true;
  // GET requests that fail with "Failed to fetch" / TypeError are typically
  // page-navigation aborts (user closed/switched the screen mid-request).
  // These are not bugs — the browser killed the request because the user
  // moved on. POSTs are still logged because aborted writes ARE serious.
  if (err instanceof TypeError && /Failed to fetch|Load failed|NetworkError/i.test(err.message)) {
    // Only suppress for GETs — extracted from the URL pattern doesn't tell us
    // the method, so we rely on the caller to set this. Conservative fallback:
    // suppress for known-safe GET-heavy paths (orders detail, payment-methods,
    // user lookups). Anything else still gets logged.
    const SAFE_GET_PATTERNS = [
      /^\/api\/orders\/[^/]+$/,             // GET single order
      /^\/api\/orders\/[^/]+\/presence$/,    // presence polls
      /^\/api\/orders\/[^/]+\/messages$/,    // chat history GET
      /^\/api\/users\/[^/]+\/payment-methods$/,
      /^\/api\/users\/[^/]+\/bank-accounts$/,
      /^\/api\/prices\//,                    // price polls
      /^\/api\/price/,                       // singular /api/price endpoint (candlestick/chart polls)
      /^\/api\/merchant\/messages/,          // chat inbox polls
      /^\/api\/merchant\/orders/,            // merchant orders list polls
      /^\/api\/merchant\/conversations/,
      /^\/api\/notifications/,
    ];
    if (SAFE_GET_PATTERNS.some((re) => re.test(path))) return true;
  }
  return false;
}

async function logNetworkFailure(
  url: string,
  method: string,
  err: unknown,
): Promise<void> {
  try {
    // Skip expected aborts (heartbeats, user-cancelled requests) — these are
    // normal browser behavior on page unload and NOT bugs. Logging them as
    // severity=ERROR pollutes the log and masks real network issues.
    if (isExpectedNetworkAbort(url, err)) return;

    const { logClientError } = await import('@/lib/errorTracking/clientLogger');
    logClientError({
      type: 'ui.api_fail.network',
      severity: 'ERROR',
      message: `${method} ${extractPath(url)} failed (network/abort): ${err instanceof Error ? err.message : String(err)}`,
      metadata: {
        url,
        method,
        errorName: err instanceof Error ? err.name : typeof err,
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });
  } catch { /* swallow */ }
}

function extractPath(url: string): string {
  try {
    const u = new URL(url, 'http://x');
    return u.pathname + (u.search || '');
  } catch {
    return url;
  }
}

// Peek at the response body WITHOUT consuming it for the caller. We clone
// the response so the original can still be read by the calling code.
async function peekBody(response: Response): Promise<string | undefined> {
  try {
    return await response.clone().text();
  } catch {
    return undefined;
  }
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

  const method = (init?.method || 'GET').toUpperCase();

  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      headers: {
        ...authHeaders,
        ...init?.headers,
      },
    });
  } catch (networkErr) {
    // fetch threw — user is offline, DNS failure, CORS, aborted, etc.
    // Log and re-throw so callers behave identically.
    void logNetworkFailure(url, method, networkErr);
    throw networkErr;
  }

  // If not 401, or if this is an auth route, return as-is
  if (response.status !== 401 || !shouldAttemptRefresh(url)) {
    // Fire-and-forget log for any non-OK response. Uses response.clone() so
    // the caller can still consume the body normally.
    if (!response.ok) {
      const bodyPeek = await peekBody(response);
      void logApiFailure(url, method, response.status, bodyPeek);
    }
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
  let retryResponse: Response;
  try {
    retryResponse = await fetch(input, {
      ...init,
      headers: {
        ...retryHeaders,
        ...init?.headers,
      },
    });
  } catch (retryNetErr) {
    void logNetworkFailure(url, method, retryNetErr);
    throw retryNetErr;
  }

  // Log the retry failure too so every failed response is tracked
  if (!retryResponse.ok) {
    const bodyPeek = await peekBody(retryResponse);
    void logApiFailure(url, method, retryResponse.status, bodyPeek);
  }

  // If the retry STILL returned 401, the new access token is also being
  // rejected — the session was revoked between refresh and retry. Force logout.
  if (retryResponse.status === 401 && shouldForceLogoutOn401(url)) {
    forceLogoutAndRedirect();
  }

  return retryResponse;
}
