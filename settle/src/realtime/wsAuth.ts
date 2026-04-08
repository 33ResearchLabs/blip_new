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
      console.log(`${WS_SHADOW_LOG_PREFIX} auth: using sessionToken.verifyAccessToken`);
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
  console.log(`${WS_SHADOW_LOG_PREFIX} auth: using WS_SHADOW_JWT_SECRET fallback`);
  return cachedVerifier;
}

export function extractToken(req: IncomingMessage): string | null {
  const authHeader = req.headers['authorization'];
  if (authHeader && typeof authHeader === 'string') {
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1];
  }
  // Browsers can't set headers on WebSocket. The standard workaround is
  // the Sec-WebSocket-Protocol header: client sends ['bearer', '<token>'],
  // we pull the second item. Production-safe (not logged like query params).
  const sub = req.headers['sec-websocket-protocol'];
  if (sub && typeof sub === 'string') {
    const parts = sub.split(',').map((s) => s.trim());
    const idx = parts.indexOf('bearer');
    if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
  }
  // Query-string fallback is dev-only — proxies/log aggregators capture
  // query params, so production must use the Authorization header.
  if (process.env.NODE_ENV !== 'production') {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const qp = url.searchParams.get('token');
      if (qp) return qp;
    } catch {
      // ignore
    }
  }
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
