/**
 * Centralized, DRY error surfacing for client actions and data fetches.
 *
 * Replaces the codebase's scattered `console.error(...)` / silent `catch {}`
 * patterns with a single path that:
 *   - classifies the failure (network / timeout / offline / 4xx / 5xx /
 *     `success:false` / unexpected),
 *   - logs it through the structured logger (so Sentry/aggregation still gets
 *     the full record), and
 *   - surfaces a clear, user-readable message via the existing modal system
 *     (`showAlert`) — or any surface the caller supplies (toast, inline banner).
 *
 * This module adds NO UI of its own — it reuses `@/components/Modal` via the
 * already-mounted `ModalProvider`, so the look is identical to existing alerts.
 *
 * Intentional cancellations (AbortError from unmount / superseded requests) are
 * never shown to the user.
 */
import { showAlert } from '@/context/ModalContext';
import { logger } from '@/lib/logger';

const DEFAULT_MESSAGE = 'Something went wrong. Please try again.';
const NETWORK_MESSAGE = 'Network error. Check your connection and try again.';
const OFFLINE_MESSAGE = "You're offline. Reconnect and try again.";
const TIMEOUT_MESSAGE = 'The request timed out. Please try again.';
const DEFAULT_TITLE = 'Action failed';

export interface NotifyErrorOptions {
  /** Modal title. Defaults to "Action failed". */
  title?: string;
  /** Message used when nothing better can be extracted from the error/body. */
  fallbackMessage?: string;
  /** Log + record only; do not surface a modal. Use sparingly. */
  silent?: boolean;
  /** Override the surface (e.g. a toast). Receives (title, message). */
  notify?: (title: string, message: string) => void;
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function isAbort(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) {
    const m = err.message.toLowerCase();
    // Browsers throw a TypeError for fetch network failures; the message text
    // varies by engine ("Failed to fetch", "NetworkError", "Load failed").
    return (
      m.includes('fetch') ||
      m.includes('network') ||
      m.includes('load failed') ||
      m.includes('connection')
    );
  }
  return false;
}

/**
 * Turn ANY thrown value / error-ish object into a single user-readable string.
 * Safe to call with `unknown` from a catch block.
 */
export function extractErrorMessage(err: unknown, fallback = DEFAULT_MESSAGE): string {
  if (isOffline()) return OFFLINE_MESSAGE;
  if (isAbort(err)) return TIMEOUT_MESSAGE;
  if (isNetworkError(err)) return NETWORK_MESSAGE;
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const candidate = o.error ?? o.message ?? o.detail;
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return fallback;
}

/**
 * Surface an error thrown in a catch block (network / timeout / unexpected).
 *
 * Returns the message that was shown (handy for also setting inline error
 * state). Returns '' — and shows nothing — for intentional cancellations.
 *
 * @param context short label for the failing operation, e.g. "createCorridor".
 */
export function notifyError(context: string, err: unknown, opts: NotifyErrorOptions = {}): string {
  // Never surface intentional cancellations (component unmount, superseded fetch).
  if (isAbort(err)) {
    logger.debug(`[${context}] request aborted`);
    return '';
  }

  const message = extractErrorMessage(err, opts.fallbackMessage ?? DEFAULT_MESSAGE);
  const title = opts.title ?? DEFAULT_TITLE;

  logger.error(`[${context}] ${message}`, { context }, err instanceof Error ? err : undefined);

  if (!opts.silent) {
    if (opts.notify) opts.notify(title, message);
    else showAlert(title, message, 'error');
  }
  return message;
}

function statusMessage(status: number, fallback = DEFAULT_MESSAGE): string {
  if (status === 0) return NETWORK_MESSAGE;
  if (status === 401 || status === 403) return 'Your session may have expired. Please sign in again.';
  if (status === 404) return 'Not found — it may have been removed.';
  if (status === 408 || status === 504) return TIMEOUT_MESSAGE;
  if (status === 409) return 'This conflicts with the current state. Refresh and try again.';
  if (status === 422) return fallback;
  if (status === 429) return "You're going too fast. Please wait a moment and try again.";
  if (status >= 500) return 'The server had a problem. Please try again shortly.';
  return fallback;
}

/**
 * Surface an API failure detected from a fetch `Response` (non-ok status, or a
 * `{ success: false }` body). Prefers the server-provided `error`/`message`,
 * then falls back to a friendly status-based message.
 *
 * If the caller has already read the JSON body, pass it as `opts.body` to avoid
 * a second read; otherwise this clones the response and reads it safely.
 *
 * Returns the message that was shown.
 *
 * @param context short label for the failing operation, e.g. "pauseOffer".
 */
export async function notifyApiError(
  context: string,
  res: Response,
  opts: NotifyErrorOptions & { body?: unknown } = {},
): Promise<string> {
  let serverMessage: string | undefined;
  let body = opts.body;
  if (body === undefined) {
    try {
      body = await res.clone().json();
    } catch {
      // Non-JSON / empty body — fall back to status-based messaging.
    }
  }
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    const candidate = o.error ?? o.message;
    if (typeof candidate === 'string' && candidate.trim()) serverMessage = candidate.trim();
  }

  const message = serverMessage ?? statusMessage(res.status, opts.fallbackMessage ?? DEFAULT_MESSAGE);
  const title = opts.title ?? DEFAULT_TITLE;

  logger.error(`[${context}] API ${res.status}: ${message}`, {
    context,
    status: res.status,
    url: res.url,
  });

  if (!opts.silent) {
    if (opts.notify) opts.notify(title, message);
    else showAlert(title, message, 'error');
  }
  return message;
}
