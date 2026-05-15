/**
 * Shadow WS auth — reuses existing token verifier read-only.
 * Falls back to WS_SHADOW_JWT_SECRET HMAC if the main verifier is unavailable
 * (e.g. running the smoke test outside Next's env).
 */
import { createHmac } from 'crypto';
import type { IncomingMessage } from 'http';
import { WS_SHADOW_LOG_PREFIX, type ActorType } from './wsEvents';

export interface WsIdentity {
  actorId: string;
  actorType: ActorType;
}

type Verifier = (token: string) => WsIdentity | null;

let cachedVerifier: Verifier | null = null;

function loadVerifier(): Verifier {
  if (cachedVerifier) return cachedVerifier;

  // Try to reuse production verifier (read-only import).
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../lib/auth/sessionToken') as {
      verifyAccessToken?: (t: string) => { actorId: string; actorType: ActorType } | null;
    };
    if (mod.verifyAccessToken) {
      cachedVerifier = (token: string) => {
        const p = mod.verifyAccessToken!(token);
        return p ? { actorId: p.actorId, actorType: p.actorType } : null;
      };

      return cachedVerifier;
    }
  } catch (err) {
    console.warn(
      `${WS_SHADOW_LOG_PREFIX} auth: sessionToken unavailable, using fallback`,
      (err as Error).message
    );
  }

  // Fallback HMAC verifier (dev/smoke only).
  const secret = process.env.WS_SHADOW_JWT_SECRET;
  cachedVerifier = (token: string) => {
    if (!secret) return null;
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf8');
      const parts = decoded.split(':');
      // shadow:actorType:actorId:ts:sig
      if (parts.length !== 5 || parts[0] !== 'shadow') return null;
      const [, actorType, actorId, ts, sig] = parts;
      const data = `shadow:${actorType}:${actorId}:${ts}`;
      const expected = createHmac('sha256', secret).update(data).digest('hex');
      if (sig !== expected) return null;
      if (!['user', 'merchant', 'compliance'].includes(actorType)) return null;
      return { actorId, actorType: actorType as ActorType };
    } catch {
      return null;
    }
  };

  return cachedVerifier;
}

export function extractToken(req: IncomingMessage): string | null {
  // 1. Authorization: Bearer <token> — preferred for non-browser clients
  //    (workers, tests) that can set arbitrary HTTP headers.
  const authHeader = req.headers['authorization'];
  if (authHeader && typeof authHeader === 'string') {
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1];
  }

  // 2. Sec-WebSocket-Protocol: bearer, <token>
  //    Browsers cannot set arbitrary headers on `new WebSocket(...)` — the
  //    standard workaround is the subprotocol field. Production-safe:
  //    proxies/log aggregators do not capture this header the way they
  //    capture query strings.
  const sub = req.headers['sec-websocket-protocol'];
  if (sub && typeof sub === 'string') {
    const parts = sub.split(',').map((s) => s.trim());
    const idx = parts.indexOf('bearer');
    if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
  }

  // 3. NO query-string fallback — even in development. Query params are
  //    logged by every reverse proxy (Cloudflare, ingress, ALB, Nginx) and
  //    persisted in browser history. The previous `?token=...` path was a
  //    high-value exfiltration target. Removed entirely.
  return null;
}

export function authenticate(req: IncomingMessage): WsIdentity | null {
  const token = extractToken(req);
  if (!token) return null;
  return loadVerifier()(token);
}

/** Utility used by the smoke test to mint a fallback-secret token. */
export function mintShadowToken(actorType: ActorType, actorId: string): string {
  const secret = process.env.WS_SHADOW_JWT_SECRET;
  if (!secret) throw new Error('WS_SHADOW_JWT_SECRET not set');
  const ts = Math.floor(Date.now() / 1000);
  const data = `shadow:${actorType}:${actorId}:${ts}`;
  const sig = createHmac('sha256', secret).update(data).digest('hex');
  return Buffer.from(`${data}:${sig}`).toString('base64');
}
