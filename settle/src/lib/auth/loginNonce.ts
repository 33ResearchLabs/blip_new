/**
 * Login nonce store — replay protection for wallet-signature auth (Issue C1).
 *
 * Flow:
 *   1. Client POSTs wallet_address to /api/auth/nonce.
 *   2. Server returns { nonce, message } and persists the nonce with a 5-min
 *      expiry, bound to that wallet_address.
 *   3. Client signs `message` exactly as returned and submits
 *      { wallet_address, signature, message, nonce } to the auth endpoint.
 *   4. Server verifies the signature, the timestamp window, and atomically
 *      consumes the nonce. A captured signed message replayed later fails.
 *
 * Storage:
 *   - Postgres `login_nonces` is source-of-truth — atomic UPDATE provides the
 *     exactly-once guarantee even if Redis is down.
 *   - Redis is a write-through fast-path (key `login_nonce:{nonce}` → wallet,
 *     TTL 300s). Gives O(1) existence check and instant invalidation, but the
 *     authoritative consumption is the Postgres UPDATE.
 */

import { randomBytes } from 'crypto';
import { query, queryOne } from '@/lib/db';
import { verifyWalletSignature } from '@/lib/solana/verifySignature';
import { redis } from '@/lib/cache/redis';

export const NONCE_TTL_SECONDS = 5 * 60;
export const NONCE_HEX_LENGTH = 64; // 32 bytes -> 64 hex chars
export const TIMESTAMP_WINDOW_MS = NONCE_TTL_SECONDS * 1000;

const REDIS_NONCE_PREFIX = 'login_nonce:';

export interface IssuedNonce {
  nonce: string;
  message: string;
  expiresAt: string; // ISO-8601
}

/** Canonical login-message format. Server and client must agree byte-for-byte. */
export function buildLoginMessage(walletAddress: string, nonce: string, timestamp: number): string {
  return `Sign this message to authenticate with Blip Money\n\nWallet: ${walletAddress}\nTimestamp: ${timestamp}\nNonce: ${nonce}`;
}

/** Issue a new nonce bound to a wallet. Caller must validate the wallet first. */
export async function issueLoginNonce(walletAddress: string): Promise<IssuedNonce> {
  const nonce = randomBytes(32).toString('hex');
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + NONCE_TTL_SECONDS * 1000);

  await query(
    `INSERT INTO login_nonces (nonce, wallet_address, issued_at, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [nonce, walletAddress, issuedAt.toISOString(), expiresAt.toISOString()]
  );

  // Write-through to Redis fast-path. SET NX so a colliding key (extremely
  // unlikely with 32 random bytes) cannot overwrite an in-flight nonce.
  // Failure is non-fatal — the Postgres row is the source of truth.
  if (redis) {
    redis
      .set(`${REDIS_NONCE_PREFIX}${nonce}`, walletAddress, 'EX', NONCE_TTL_SECONDS, 'NX')
      .catch((err) => console.warn('[security][login] redis SET nonce failed:', err?.message));
  }

  // Best-effort housekeeping. Keeps the table from growing unbounded if the
  // separate cleanup cron isn't installed yet. Errors are non-fatal.
  query(`DELETE FROM login_nonces WHERE expires_at < NOW() - INTERVAL '1 hour'`).catch(() => {});

  return {
    nonce,
    message: buildLoginMessage(walletAddress, nonce, issuedAt.getTime()),
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Extract the `Timestamp:` value the client signed and confirm it's inside the
 * allowed window. Even if the nonce somehow survived (e.g. a clock-skew bug
 * delayed expiry), an attacker replaying a months-old signed message still
 * fails this check. Returns null on success or a 4xx error envelope.
 */
function checkTimestampWindow(signedMessage: string): { status: number; error: string } | null {
  const m = signedMessage.match(/Timestamp:\s*(\d+)/);
  if (!m) return { status: 400, error: 'Login message is missing Timestamp' };
  const ts = Number(m[1]);
  if (!Number.isFinite(ts)) return { status: 400, error: 'Login message has invalid Timestamp' };
  const skew = Math.abs(Date.now() - ts);
  if (skew > TIMESTAMP_WINDOW_MS) {
    return { status: 401, error: 'Login message expired' };
  }
  return null;
}

/**
 * Atomically consume a nonce. Returns true ONLY if the nonce exists, belongs
 * to `walletAddress`, is unexpired and unconsumed, AND the signed message
 * actually contains that nonce string. The single Postgres UPDATE provides
 * the "exactly-once" guarantee even under concurrent replay attempts;
 * Redis is purged after as a fast-path for subsequent existence checks.
 */
export async function consumeLoginNonce(
  nonce: string,
  walletAddress: string,
  signedMessage: string
): Promise<boolean> {
  if (typeof nonce !== 'string' || nonce.length === 0 || nonce.length > 128) return false;

  // Bind the signed payload to the nonce. Without this an attacker who has
  // a valid (wallet, signature, message) triple could pair it with any
  // unrelated unconsumed nonce belonging to that same wallet.
  if (!signedMessage.includes(`Nonce: ${nonce}`)) return false;

  // Fast-path negative check: if Redis says the nonce isn't there OR is
  // bound to a different wallet, fail fast without burning a Postgres
  // round-trip. Redis-down is treated as "unknown" — fall through to PG.
  if (redis && redis.status === 'ready') {
    try {
      const cached = await redis.get(`${REDIS_NONCE_PREFIX}${nonce}`);
      if (cached !== null && cached !== walletAddress) return false;
    } catch { /* non-fatal */ }
  }

  const row = await queryOne<{ nonce: string }>(
    `UPDATE login_nonces
        SET consumed_at = NOW()
      WHERE nonce = $1
        AND wallet_address = $2
        AND consumed_at IS NULL
        AND expires_at > NOW()
      RETURNING nonce`,
    [nonce, walletAddress]
  );

  if (row !== null && redis) {
    redis.del(`${REDIS_NONCE_PREFIX}${nonce}`).catch(() => {});
  }
  return row !== null;
}

/**
 * One-shot helper: nonce + timestamp window + signature, all required.
 *
 * Returns a discriminated union so callers can map straight to a 4xx response.
 * There is NO fallback path — every login-equivalent route MUST go through
 * here, and every caller MUST pass a server-issued nonce. The legacy
 * `LOGIN_NONCE_REQUIRED=false` mode has been removed; old client bundles that
 * don't pass a nonce now get a 400 and must reload to fetch the new bundle.
 */
export async function verifyWalletAuthRequest(input: {
  walletAddress: string;
  signature: string;
  message: string;
  nonce: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { walletAddress, signature, message, nonce } = input;

  if (!walletAddress || !signature || !message || !nonce) {
    return {
      ok: false,
      status: 400,
      error: 'wallet_address, signature, message, and nonce are required',
    };
  }

  // Timestamp window — defense-in-depth even if a nonce somehow leaked past
  // its TTL. Cheap check, runs before signature verification.
  const tsErr = checkTimestampWindow(message);
  if (tsErr) return { ok: false, ...tsErr };

  const validSig = await verifyWalletSignature(walletAddress, signature, message);
  if (!validSig) {
    return { ok: false, status: 401, error: 'Invalid wallet signature' };
  }

  const consumed = await consumeLoginNonce(nonce, walletAddress, message);
  if (!consumed) {
    return { ok: false, status: 401, error: 'Nonce expired, already used, or does not match wallet' };
  }

  return { ok: true };
}
