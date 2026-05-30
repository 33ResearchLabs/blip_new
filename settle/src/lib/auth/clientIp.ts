/**
 * Client IP extraction & normalization.
 *
 * Centralizes how we derive the *real* client IP behind reverse proxies,
 * load balancers, Cloudflare and Vercel — and guarantees we never store or
 * display a loopback / unspecified address for a production user (the cause
 * of `::1` showing up in the merchant "Active Sessions" list).
 *
 * Used by session creation/rotation (storage) and the sessions API (display).
 */

type HeaderBag = { get: (name: string) => string | null };
type IpRequest = {
  headers?: HeaderBag;
  ip?: string;
  socket?: { remoteAddress?: string };
};

/**
 * Resolve the best-guess client IP from a request, or `null` when only a
 * loopback / unknown address is available.
 *
 * Header precedence (most → least specific):
 *   1. cf-connecting-ip      — Cloudflare
 *   2. true-client-ip        — Cloudflare Enterprise / Akamai
 *   3. x-vercel-forwarded-for — Vercel edge (left-most hop = client)
 *   4. x-forwarded-for       — standard proxy chain (left-most hop = client)
 *   5. x-real-ip             — nginx / single reverse proxy
 *   6. fly-client-ip         — Fly.io
 *   7. request.ip            — framework-provided (older Next runtimes)
 *   8. request.socket.remoteAddress — direct Node socket (custom server.js)
 */
export function extractClientIp(request?: IpRequest | null): string | null {
  if (!request) return null;

  const header = (name: string): string | null => {
    try {
      return request.headers?.get?.(name) ?? null;
    } catch {
      return null;
    }
  };

  const candidates: (string | null | undefined)[] = [
    header('cf-connecting-ip'),
    header('true-client-ip'),
    firstHop(header('x-vercel-forwarded-for')),
    firstHop(header('x-forwarded-for')),
    header('x-real-ip'),
    header('fly-client-ip'),
    request.ip,
    request.socket?.remoteAddress,
  ];

  for (const candidate of candidates) {
    const ip = normalizeClientIp(candidate);
    if (ip) return ip;
  }
  return null;
}

/** Left-most hop of a comma-separated forwarded-for chain = the client. */
function firstHop(value: string | null): string | null {
  if (!value) return null;
  return value.split(',')[0]?.trim() || null;
}

/**
 * Normalize a single IP candidate and reject values that must never be
 * shown to a production user. Returns the cleaned IP, or `null` for
 * loopback / unspecified / empty / "unknown" inputs (caller renders these
 * as "Unknown IP"). Safe to call on already-stored values for display.
 *
 * - Strips IPv6 brackets: `[::1]` → `::1`
 * - Unwraps IPv4-mapped IPv6: `::ffff:1.2.3.4` → `1.2.3.4`
 * - Drops a trailing `:port` on IPv4 only (never on bare IPv6)
 */
export function normalizeClientIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let ip = raw.trim();
  if (!ip) return null;

  // Strip surrounding brackets used for IPv6 literals.
  ip = ip.replace(/^\[/, '').replace(/\]$/, '');

  // IPv4-mapped IPv6 → plain IPv4.
  if (ip.toLowerCase().startsWith('::ffff:')) {
    ip = ip.slice('::ffff:'.length);
  }

  // Drop a trailing :port for IPv4 ("1.2.3.4:5678" → "1.2.3.4").
  // Never strip for IPv6, where ':' is structural.
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) {
    ip = ip.split(':')[0];
  }

  const lower = ip.toLowerCase();
  if (
    lower === '' ||
    lower === 'unknown' ||
    lower === '::' ||
    lower === '::1' ||
    lower === '0.0.0.0' ||
    lower.startsWith('127.')
  ) {
    return null;
  }

  return ip;
}
