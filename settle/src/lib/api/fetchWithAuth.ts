/**
 * fetchWithAuth — drop-in replacement for fetch() that flows the httpOnly
 * `blip_access_token` cookie on every browser call and transparently
 * refreshes it when expired.
 *
 * Auth model (browser):
 *   - The browser sends `blip_access_token` automatically (httpOnly cookie,
 *     `credentials: 'include'`). We add NO Authorization header and NO
 *     x-{user,merchant,compliance}-id identity headers — those reflected
 *     localStorage state, which an attacker could write to.
 *   - On 401 → ONE silent refresh via POST /api/auth/refresh; the refresh
 *     route rotates the cookie pair (httpOnly), and we retry the request.
 *   - On retry-401 → /api/auth/logout (server clears cookies) and redirect.
 *
 * Auth model (SSR / server):
 *   Node has no cookie jar. Server callers (RSC, server actions, API
 *   routes calling other API routes, smoke scripts) must pass an explicit
 *   `token` in `init.token`. We attach it as `Authorization: Bearer ...`
 *   for that single call only. The token never reaches the browser.
 *
 * Identity is whatever the verified token (cookie OR explicit Bearer) says;
 * nothing client-asserted.
 *
 * Usage (browser):
 *   const res = await fetchWithAuth('/api/merchant/orders?...');
 *
 * Usage (SSR / server, e.g. in a server component or server action):
 *   const res = await fetchWithAuth(`${origin}/api/merchant/orders`, {
 *     token: serverSideAccessToken,   // mint server-side via setSessionOnResponse
 *   });
 */

import { useMerchantStore } from '@/stores/merchantStore';

/**
 * Extension of `RequestInit` that allows server-side callers to pass an
 * explicit access token. Browser callers MUST NOT use this — it would
 * negate the point of the httpOnly cookie. We enforce the asymmetry at
 * runtime: the token is silently dropped if `typeof window !== 'undefined'`.
 */
export interface FetchWithAuthInit extends RequestInit {
  /** Server-side only. Forwarded as `Authorization: Bearer <token>`. */
  token?: string;
}

const IS_SERVER = typeof window === 'undefined';

// Device fingerprint headers (NOT auth — used by risk/anomaly tracking on
// the server). Cached in module scope rather than sessionStorage so we hold
// no client-side state that could be confused for auth material. The cache
// is per-tab for free (a new tab = a new module load).
let _deviceId: string | null = null;
let _deviceMeta: string | null = null;
let _deviceInitPromise: Promise<void> | null = null;

async function initDeviceFingerprint(): Promise<void> {
  if (_deviceInitPromise) return _deviceInitPromise;
  if (_deviceId) return;
  _deviceInitPromise = (async () => {
    try {
      if (typeof window === 'undefined') return;
      const { getDeviceInfo } = await import('@/lib/device/fingerprint');
      const { deviceId, metadata } = await getDeviceInfo();
      _deviceId = deviceId;
      _deviceMeta = JSON.stringify(metadata);
    } catch {
      // Non-critical — risk tracking will still work without the FP header.
    }
  })();
  return _deviceInitPromise;
}

function getAuthHeaders(serverToken?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  // Identity comes from the cookie in the browser. The only header we
  // attach there is the device fingerprint — explicitly NOT secret, used
  // purely by the risk tracker on the server. If the FP isn't computed
  // yet, send nothing rather than a half-formed value.
  if (_deviceId) {
    headers['x-device-id'] = _deviceId;
    if (_deviceMeta) headers['x-device-meta'] = _deviceMeta;
  }
  // Server-side ONLY: explicit Bearer for SSR/RSC/script callers that have
  // no cookie jar. The IS_SERVER guard means a malicious client cannot
  // smuggle a token through this path even if a typo causes `token` to be
  // passed from browser code — the header is suppressed.
  if (serverToken && IS_SERVER) {
    headers['Authorization'] = `Bearer ${serverToken}`;
  }
  return headers;
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

/**
 * Result of a refresh attempt. We distinguish three outcomes so the caller
 * can react correctly:
 *
 *   - `ok: true`     → server minted a new access cookie; retry the request.
 *   - `ok: false, revoked: true`  → server explicitly rejected the refresh
 *     cookie (HTTP 401 / 403 / success:false). The session is dead — wipe
 *     in-memory state and force the user to log in again.
 *   - `ok: false, revoked: false` → transient failure (rate limit 429, 5xx,
 *     network blip, malformed body). The session may still be valid — DO
 *     NOT force logout. The caller returns the original 401 to its caller;
 *     a subsequent action will retry refresh naturally.
 *
 * Why the distinction matters: under multi-tab load, /api/auth/refresh can
 * occasionally hit the per-IP rate limit (or briefly time out). Treating
 * those as "session dead" silently logs the user out and dumps them on the
 * login screen — the symptom that motivated this change.
 */
type RefreshResult =
  | { ok: true; token: string }
  | { ok: false; revoked: boolean };

let refreshPromise: Promise<RefreshResult> | null = null;

// Suppresses outbound refresh calls until this timestamp. Set when the
// refresh endpoint returns 429 (or honours Retry-After). Without this guard,
// every subsequent 401 across N polling loops + Pusher reconnects would fire
// another refresh, immediately re-hit the rate-limit, and spin in a 401↔429
// loop until the window resets (~60s) — the symptom that motivated this.
let refreshBackoffUntilMs = 0;

// Consecutive-401 tracking.
//
// Background: when /api/auth/refresh fails with a *non-401/403* status
// (5xx, 429, network) we classify it `revoked: false` and intentionally
// DO NOT force-logout — a single transient infra blip shouldn't eject a
// valid user. Cost of that policy alone: if cookies are genuinely dead
// but refresh keeps returning transient failures (or `hadToken` is false
// so refresh is skipped entirely), every subsequent API call 401s, the
// UI never recovers, and the user sees a zombie "still logged in"
// dashboard with no data — the bug shown in the screenshot.
//
// Fix: count consecutive 401s on protected routes. If the count crosses
// AUTH_FAILURE_LOGOUT_THRESHOLD before any 2xx resets it, we treat the
// session as effectively dead and force logout. Three is a deliberate
// balance — high enough to absorb one bad 5xx, low enough that a real
// session-loss is a short stuck-state, not a permanent one.
const AUTH_FAILURE_LOGOUT_THRESHOLD = 3;
let consecutiveAuthFailures = 0;

async function refreshAccessToken(): Promise<RefreshResult> {
  // If a refresh is already in-flight, piggyback on it
  if (refreshPromise) return refreshPromise;

  // If we recently got 429'd, short-circuit and report transient failure
  // without touching the network. Callers already handle `{ ok: false,
  // revoked: false }` as transient (no forced logout), so behaviour matches
  // a real 429 response — just without hammering the endpoint.
  if (Date.now() < refreshBackoffUntilMs) {
    return { ok: false, revoked: false };
  }

  refreshPromise = (async (): Promise<RefreshResult> => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        // Required for the refresh cookie (httpOnly, path-narrow) to flow.
        credentials: 'include',
      });

      // 401 / 403 = server explicitly rejected the refresh cookie. The
      // session is genuinely dead (token revoked, expired, reused, or
      // belongs to a banned actor). Wipe local mirror and let the caller
      // force-logout.
      if (res.status === 401 || res.status === 403) {
        useMerchantStore.getState().setSessionToken(null);
        return { ok: false, revoked: true };
      }

      // 429 = we tripped the refresh rate-limit. Honour Retry-After if the
      // server sent one, else default to 5s. During this window we suppress
      // further refresh attempts (see refreshBackoffUntilMs above).
      if (res.status === 429) {
        const retryAfterHeader = res.headers.get('retry-after');
        const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
        const backoffSec = Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? Math.min(retryAfterSec, 60)
          : 5;
        refreshBackoffUntilMs = Date.now() + backoffSec * 1000;
        return { ok: false, revoked: false };
      }

      // Any other non-2xx (5xx etc.) is TRANSIENT. The refresh cookie may
      // still be valid; we just couldn't talk to the server right now. Keep
      // the in-memory token so subsequent UI observers don't flip to
      // "logged out" prematurely.
      if (!res.ok) {
        return { ok: false, revoked: false };
      }

      const data = await res.json().catch(() => null);
      if (data?.success && data?.data?.accessToken) {
        // Mirror the new access token in the store for UI observers. The
        // durable copy is the rotated `blip_access_token` cookie that the
        // refresh route just set — we never touch sessionStorage.
        useMerchantStore.getState().setSessionToken(data.data.accessToken);
        // Successful refresh clears any prior backoff so the next 401 can
        // retry immediately.
        refreshBackoffUntilMs = 0;
        return { ok: true, token: data.data.accessToken as string };
      }

      // 200 with malformed body — treat as transient (don't logout); the
      // caller will retry on a future action.
      return { ok: false, revoked: false };
    } catch {
      // Network error during refresh — transient by definition.
      return { ok: false, revoked: false };
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
  // Pusher channel auth — a 401 here means the token aged out mid-session.
  // The silent refresh + retry above handles recovery; if it still fails,
  // realtime degrades gracefully (polling fallbacks kick in) but the user
  // must NOT be log-out-redirected for it. Other foreground API calls will
  // surface a real session expiry on their own when needed.
  '/api/pusher/auth',
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
 *
 * The redirect URL gets a `?reason=session_expired` (or `?expired=1` on
 * waitlist) banner trigger ONLY when there's evidence the user actually
 * had a session to lose. A landing-page visitor who's never been logged
 * in shouldn't see "Your session expired" — that's confusing and wrong.
 * We detect prior auth by sniffing the in-memory store token and the two
 * persistent identity markers (`blip_user`, `blip_merchant`). If none of
 * those have ever been set in this browser context, we redirect to a
 * clean login URL with no banner.
 */
function forceLogoutAndRedirect(): void {
  if (forcedLogoutInProgress) return;
  forcedLogoutInProgress = true;
  if (typeof window === 'undefined') return;

  // Snapshot auth evidence BEFORE we wipe anything — otherwise we'd
  // always see "no auth" and never show the banner for real expiries.
  let hadAuthEvidence = false;
  try {
    if (useMerchantStore.getState().sessionToken) hadAuthEvidence = true;
    if (!hadAuthEvidence && window.localStorage.getItem('blip_user')) hadAuthEvidence = true;
    if (!hadAuthEvidence && window.localStorage.getItem('blip_merchant')) hadAuthEvidence = true;
  } catch { /* storage disabled — assume no evidence */ }

  try {
    // Wipe in-memory store mirrors. The DURABLE auth state lives in the
    // httpOnly cookies — those get cleared by the /api/auth/logout call
    // below (server response sets Max-Age=0 on both access + refresh).
    useMerchantStore.getState().setSessionToken(null);
    const setMerchantId = (useMerchantStore.getState() as any).setMerchantId;
    const setMerchantInfo = (useMerchantStore.getState() as any).setMerchantInfo;
    if (typeof setMerchantId === 'function') setMerchantId(null);
    if (typeof setMerchantInfo === 'function') setMerchantInfo(null);
  } catch { /* store not hydrated — ignore */ }

  // Tell the server to invalidate the session and clear the auth cookies.
  // Fire-and-forget; we redirect even if this races, because the in-memory
  // state is already wiped and the dead cookie can't authenticate anything
  // useful in the time it takes the redirect to land.
  try {
    void fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
    });
  } catch { /* ignore — redirect proceeds */ }

  // Pick the right login page based on where the user currently is.
  // Banner suffix only when we actually had something to lose — see the
  // hadAuthEvidence comment above.
  const path = window.location.pathname;
  let target = '/login';
  let bannerQs = hadAuthEvidence ? '?reason=session_expired' : '';
  if (path.startsWith('/market')) {
    target = '/market/login';
  } else if (path.startsWith('/user')) {
    // User app lives at /user — bounce straight to its own sign-in route
    // instead of relying on /login's re-redirect (avoids a double hop and
    // keeps the ?reason=session_expired banner intact).
    target = '/user/login';
  } else if (path.startsWith('/admin')) {
    target = '/admin';
    bannerQs = hadAuthEvidence ? '?session=expired' : '';
  } else if (path.startsWith('/compliance')) {
    target = '/compliance';
    bannerQs = hadAuthEvidence ? '?session=expired' : '';
  } else if (path.startsWith('/waitlist')) {
    // Waitlist sessions split by role — read the cached actor type so a
    // merchant whose token died doesn't get bounced to the user login form.
    // Key matches `blip_waitlist_actor_type` in src/lib/waitlist/roleCache.ts.
    let role: string | null = null;
    try { role = window.localStorage.getItem('blip_waitlist_actor_type'); } catch { /* storage disabled */ }
    target = role === 'merchant' ? '/waitlist/merchant-login' : '/waitlist/login';
    bannerQs = hadAuthEvidence ? '?expired=1' : '';
  }

  // Use replace so the dead-token page can't be reached via Back button
  window.location.replace(`${target}${bannerQs}`);
}

/**
 * Drop-in replacement for window.fetch with auth flowing via the httpOnly
 * cookie (browser) or an explicit Bearer (server). Signature is fetch()
 * plus an optional `token` field on init for SSR.
 *
 * - GET requests are automatically deduplicated (browser only — server
 *   calls bypass the dedup cache to avoid leaking tokens across requests)
 * - 401 responses trigger transparent token refresh + retry (browser only)
 * - Auth routes are excluded from refresh to prevent loops
 */
export function fetchWithAuth(
  input: RequestInfo | URL,
  init?: FetchWithAuthInit,
): Promise<Response> {
  // Lazily init device fingerprint (non-blocking, runs once). No-op on the
  // server — `initDeviceFingerprint` early-returns when `window` is absent.
  initDeviceFingerprint().catch(() => {});

  const method = (init?.method || 'GET').toUpperCase();
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  // Server-side path: no GET dedup (each SSR/RSC pass should run its own
  // fetches; sharing a promise across requests would leak the token from
  // one render into another). No 401-refresh either — the server caller
  // owns the token's lifecycle.
  if (IS_SERVER) {
    return executeServer(input, init, url);
  }

  // Browser GET deduplication
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
 * Server-side fetch path. Cookies don't exist here — Next.js server runtimes
 * have no jar — so the caller MUST supply `init.token` for any auth-required
 * route. We attach it as Bearer once and do not retry on 401 (the caller
 * already controls the token lifecycle).
 */
async function executeServer(
  input: RequestInfo | URL,
  init: FetchWithAuthInit | undefined,
  url: string,
): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase();
  const authHeaders = getAuthHeaders(init?.token);
  // Strip our extension key before forwarding to native fetch.
  const { token: _stripped, ...nativeInit } = init || {};
  void _stripped;
  try {
    return await fetch(input, {
      ...nativeInit,
      // 'omit' is the safe default on the server: any cookie-like header
      // present in `init.headers` would be the caller's deliberate choice;
      // we don't auto-attach a cookie jar that doesn't exist.
      credentials: nativeInit.credentials ?? 'omit',
      headers: {
        ...authHeaders,
        ...nativeInit.headers,
      },
    });
  } catch (networkErr) {
    void logNetworkFailure(url, method, networkErr);
    throw networkErr;
  }
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

// ── 429 backoff: skip same-bucket calls until Retry-After elapses ────
// When an endpoint returns 429, every subsequent call to the same path
// would ALSO be rejected until the window resets. Polling code (heartbeat,
// chat refresh, dashboard inbox) keeps firing at fixed intervals and just
// burns through the bucket again without ever giving the server a break.
// We track a per-path "blocked until" timestamp; calls inside that window
// short-circuit with a synthetic 429 instead of hitting the network.
const blockedUntilByPath = new Map<string, number>();
const MAX_BACKOFF_MS = 30_000;

function isBlockedByBackoff(path: string): number {
  const until = blockedUntilByPath.get(path);
  if (!until) return 0;
  const now = Date.now();
  if (until <= now) {
    blockedUntilByPath.delete(path);
    return 0;
  }
  return until - now;
}

function markBlocked(path: string, retryAfterSec: number): void {
  // Cap the block window — if a misconfigured server returns Retry-After:
  // 3600, we don't want to lock the UI out for an hour.
  const ms = Math.min(Math.max(retryAfterSec * 1000, 1000), MAX_BACKOFF_MS);
  blockedUntilByPath.set(path, Date.now() + ms);
}

function syntheticRateLimitResponse(retryAfterMs: number): Response {
  const retryAfter = Math.ceil(retryAfterMs / 1000);
  return new Response(
    JSON.stringify({
      success: false,
      error: 'Too many requests',
      message: `Rate limited locally — retry in ${retryAfter}s`,
      retryAfter,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': retryAfter.toString(),
        'X-RateLimit-Source': 'client-backoff',
      },
    },
  );
}

/**
 * Execute a fetch with auth headers. If the response is 401 and the URL
 * is not an auth route, attempt ONE token refresh and retry.
 *
 * Browser-only path: the cookie carries auth, refresh runs against the
 * httpOnly refresh cookie. Server-side calls take the executeServer branch
 * above (no refresh, no dedup, explicit Bearer).
 */
async function executeWithRefresh(
  input: RequestInfo | URL,
  init: FetchWithAuthInit | undefined,
  url: string,
): Promise<Response> {
  // `token` is server-only; if a browser caller passes it, the IS_SERVER
  // guard inside getAuthHeaders drops it. Strip it from the native init
  // so it can't leak into the request body or headers via spread.
  const { token: _stripped, ...nativeInit } = init || {};
  void _stripped;
  const authHeaders = getAuthHeaders();

  const method = (nativeInit?.method || 'GET').toUpperCase();
  const path = extractPath(url).split('?')[0];

  // Local backoff: if a recent GET to this path returned 429, short-circuit
  // until the window expires. This protects the server from polling pressure
  // (heartbeat, chat refresh, dashboard inbox) without changing observable
  // behaviour — the next poll tick just gets a synthetic 429 instead of
  // burning the bucket again.
  //
  // CRITICAL: only apply to GET. State-changing methods (POST/PATCH/DELETE)
  // are user-initiated — clicking "Confirm Payment" must NEVER be silently
  // rejected by client-side code as "Too many requests." If the server
  // genuinely rate-limits a mutation, the user sees that error directly;
  // we must not pre-empt with a fake one.
  if (method === 'GET') {
    const blockedFor = isBlockedByBackoff(path);
    if (blockedFor > 0) {
      return syntheticRateLimitResponse(blockedFor);
    }
  }

  let response: Response;
  try {
    response = await fetch(input, {
      ...nativeInit,
      // `include` so the httpOnly cookie pair (`blip_access_token` +
      // `blip_refresh_token`) flows on every request, including any future
      // cross-origin deployment. Same-origin already gets cookies by
      // default, but explicit > implicit when the credential IS the auth.
      credentials: nativeInit.credentials ?? 'include',
      headers: {
        ...authHeaders,
        ...nativeInit.headers,
      },
    });
  } catch (networkErr) {
    // fetch threw — user is offline, DNS failure, CORS, aborted, etc.
    // Log and re-throw so callers behave identically.
    void logNetworkFailure(url, method, networkErr);
    throw networkErr;
  }

  // 429 → record the cooldown window so subsequent same-path GETs skip
  // the network until the server's bucket resets. Honor Retry-After when
  // the server supplies it; fall back to 5s otherwise.
  // Only seed the backoff from GETs — a mutation that 429s is one-shot
  // user intent and shouldn't poison the bucket for anything else.
  if (response.status === 429 && method === 'GET') {
    const ra = parseInt(response.headers.get('Retry-After') || '0', 10);
    markBlocked(path, ra > 0 ? ra : 5);
  }

  // If not 401, or if this is an auth route, return as-is
  if (response.status !== 401 || !shouldAttemptRefresh(url)) {
    // Fire-and-forget log for any non-OK response. Uses response.clone() so
    // the caller can still consume the body normally.
    if (!response.ok) {
      const bodyPeek = await peekBody(response);
      void logApiFailure(url, method, response.status, bodyPeek);
    }
    // Any 2xx on a protected-path call clears the consecutive-401 counter —
    // the session is demonstrably alive. Status >= 400 from a non-auth
    // endpoint without 401 (e.g. 403, 422) does NOT reset the counter
    // because it doesn't prove the session is valid.
    if (response.ok && shouldForceLogoutOn401(url)) {
      consecutiveAuthFailures = 0;
    }
    return response;
  }

  // Probe the in-memory mirror to decide whether a 401 is worth refreshing
  // for. If the user was never logged in (no in-memory token AND no
  // sessionId observable), the 401 is expected — skip the refresh roundtrip.
  // The previous gate keyed off `Authorization: Bearer ...`, but we no
  // longer attach that header. Cookies aren't readable from JS by design,
  // so the in-memory mirror is the only proxy we have.
  const hadToken = !!useMerchantStore.getState().sessionToken;
  if (!hadToken) {
    // 401 on a protected route with no in-memory session = strongly
    // suggestive of a zombie state (cookies dead, mirror cleared, but the
    // UI still rendering logged-in chrome from cached state). Count it
    // toward the threshold; force-logout when we cross it. See
    // AUTH_FAILURE_LOGOUT_THRESHOLD comment for the rationale.
    if (shouldForceLogoutOn401(url)) {
      consecutiveAuthFailures += 1;
      if (consecutiveAuthFailures >= AUTH_FAILURE_LOGOUT_THRESHOLD) {
        forceLogoutAndRedirect();
      }
    }
    return response;
  }

  // Attempt silent refresh
  const refreshRes = await refreshAccessToken();
  if (!refreshRes.ok) {
    // Force logout when the server EXPLICITLY revoked the session OR when
    // we've accumulated enough non-revoked failures that the session is
    // effectively dead. The transient case (1-2 failures) still rides on
    // the user's existing cookie — but persistent failure is no longer a
    // zombie state.
    if (shouldForceLogoutOn401(url)) {
      if (refreshRes.revoked) {
        forceLogoutAndRedirect();
      } else {
        consecutiveAuthFailures += 1;
        if (consecutiveAuthFailures >= AUTH_FAILURE_LOGOUT_THRESHOLD) {
          forceLogoutAndRedirect();
        }
      }
    }
    return response;
  }

  // Retry with the rotated cookie pair (set by /api/auth/refresh).
  const retryHeaders = getAuthHeaders();
  let retryResponse: Response;
  try {
    retryResponse = await fetch(input, {
      ...nativeInit,
      credentials: nativeInit.credentials ?? 'include',
      headers: {
        ...retryHeaders,
        ...nativeInit.headers,
      },
    });
  } catch (retryNetErr) {
    void logNetworkFailure(url, method, retryNetErr);
    throw retryNetErr;
  }

  // 429 on the post-refresh retry → also feed the local backoff window
  // (GETs only) so the next same-path call short-circuits.
  if (retryResponse.status === 429 && method === 'GET') {
    const ra = parseInt(retryResponse.headers.get('Retry-After') || '0', 10);
    markBlocked(path, ra > 0 ? ra : 5);
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
  } else if (retryResponse.ok && shouldForceLogoutOn401(url)) {
    // Successful retry on a protected route → session is demonstrably
    // alive. Reset the counter so a future transient blip doesn't
    // inherit accumulated failures.
    consecutiveAuthFailures = 0;
  }

  return retryResponse;
}
