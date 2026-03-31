/**
 * TOTP (Time-based One-Time Password) utilities for Google Authenticator 2FA.
 *
 * Uses otplib (which wraps the standard TOTP RFC 6238 algorithm).
 * Secrets are encrypted before DB storage via AES-256-GCM.
 */

import { generateSecret, verifySync } from 'otplib';
import * as QRCode from 'qrcode';
import { randomBytes, createHash } from 'crypto';
import { encrypt, decrypt } from '@/lib/utils/encryption';
import { query, queryOne } from '@/lib/db';

// ── Config ──────────────────────────────────────────────────────────
const ISSUER = process.env.TOTP_ISSUER || 'Blip';
const WINDOW = parseInt(process.env.TOTP_WINDOW || '1', 10); // Allow ±1 time step for clock drift
const TEMP_TOKEN_TTL_SEC = 5 * 60; // 5 min expiry for pending login tokens
const MAX_ATTEMPTS_PER_WINDOW = 5; // Max failed OTP attempts per 15-min window
const ATTEMPT_WINDOW_SEC = 15 * 60;

// ── Secret Generation ───────────────────────────────────────────────

export interface TotpSetupResult {
  secret: string;       // Base32 secret (show to user for manual entry)
  qrDataUrl: string;    // Data URL for QR code image
  otpauthUrl: string;   // otpauth:// URI
}

/**
 * Generate a new TOTP secret and QR code for setup.
 * The secret is NOT stored yet — caller must store it as temp.
 */
export async function generateTotpSetup(
  accountName: string,
): Promise<TotpSetupResult> {
  const secret = generateSecret();
  const otpauthUrl = `otpauth://totp/${encodeURIComponent(ISSUER)}:${encodeURIComponent(accountName)}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=30`;
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

  return { secret, qrDataUrl, otpauthUrl };
}

// ── Verification ────────────────────────────────────────────────────

/**
 * Verify a TOTP code against a plaintext secret.
 */
export function verifyTotp(token: string, secret: string): boolean {
  try {
    const result = verifySync({ token, secret });
    return result?.valid === true;
  } catch {
    return false;
  }
}

/**
 * Verify a TOTP code against an encrypted secret from DB.
 */
export function verifyTotpEncrypted(token: string, encryptedSecret: string): boolean {
  try {
    const secret = decrypt(encryptedSecret);
    const result = verifySync({ token, secret });
    return result?.valid === true;
  } catch {
    return false;
  }
}

// ── DB Operations ───────────────────────────────────────────────────

type ActorType = 'merchant' | 'user';

function getTable(actorType: ActorType): string {
  return actorType === 'merchant' ? 'merchants' : 'users';
}

/**
 * Store a temporary (unverified) TOTP secret for setup flow.
 * Encrypted before storage. Overwrites any previous temp secret.
 */
export async function storeTempSecret(
  actorId: string,
  actorType: ActorType,
  secret: string,
): Promise<void> {
  const encrypted = encrypt(secret);
  const table = getTable(actorType);
  // Store in totp_secret column but don't enable yet
  await query(
    `UPDATE ${table} SET totp_secret = $1, totp_enabled = false WHERE id = $2`,
    [encrypted, actorId]
  );
}

/**
 * Enable 2FA after successful verification of the temp secret.
 */
export async function enableTotp(actorId: string, actorType: ActorType): Promise<void> {
  const table = getTable(actorType);
  await query(
    `UPDATE ${table} SET totp_enabled = true, totp_verified_at = NOW() WHERE id = $1`,
    [actorId]
  );
}

/**
 * Disable 2FA and remove the stored secret.
 */
export async function disableTotp(actorId: string, actorType: ActorType): Promise<void> {
  const table = getTable(actorType);
  await query(
    `UPDATE ${table} SET totp_secret = NULL, totp_enabled = false, totp_verified_at = NULL WHERE id = $1`,
    [actorId]
  );
}

/**
 * Get TOTP status for an actor.
 */
export async function getTotpStatus(
  actorId: string,
  actorType: ActorType,
): Promise<{ enabled: boolean; secret: string | null; verifiedAt: string | null }> {
  const table = getTable(actorType);
  const row = await queryOne<{ totp_enabled: boolean; totp_secret: string | null; totp_verified_at: string | null }>(
    `SELECT totp_enabled, totp_secret, totp_verified_at FROM ${table} WHERE id = $1`,
    [actorId]
  );
  if (!row) return { enabled: false, secret: null, verifiedAt: null };
  return {
    enabled: row.totp_enabled ?? false,
    secret: row.totp_secret,
    verifiedAt: row.totp_verified_at,
  };
}

// ── Pending Login Tokens ────────────────────────────────────────────

/**
 * Create a short-lived token for the 2FA login challenge.
 * Returned to the client after password is verified but before TOTP is checked.
 */
export async function createPendingLoginToken(
  actorId: string,
  actorType: ActorType,
): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + TEMP_TOKEN_TTL_SEC * 1000);

  await query(
    `INSERT INTO totp_pending_logins (actor_id, actor_type, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [actorId, actorType, tokenHash, expiresAt.toISOString()]
  );

  return token;
}

/**
 * Verify and consume a pending login token.
 * Returns the actor info if valid, null otherwise.
 */
export async function consumePendingLoginToken(
  token: string,
): Promise<{ actorId: string; actorType: ActorType } | null> {
  const tokenHash = createHash('sha256').update(token).digest('hex');

  const row = await queryOne<{ actor_id: string; actor_type: string }>(
    `UPDATE totp_pending_logins
     SET used = true
     WHERE token_hash = $1 AND NOT used AND expires_at > NOW()
     RETURNING actor_id, actor_type`,
    [tokenHash]
  );

  if (!row) return null;
  return { actorId: row.actor_id, actorType: row.actor_type as ActorType };
}

// ── Rate Limiting ───────────────────────────────────────────────────

/**
 * Record an OTP attempt (success or failure).
 */
export async function recordAttempt(
  actorId: string,
  actorType: ActorType,
  success: boolean,
  ipAddress?: string,
): Promise<void> {
  await query(
    `INSERT INTO totp_attempts (actor_id, actor_type, success, ip_address) VALUES ($1, $2, $3, $4)`,
    [actorId, actorType, success, ipAddress || null]
  );
}

/**
 * Check if actor has exceeded OTP attempt limit.
 */
export async function isRateLimited(actorId: string, actorType: ActorType): Promise<boolean> {
  const row = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM totp_attempts
     WHERE actor_id = $1 AND actor_type = $2 AND NOT success
     AND created_at > NOW() - INTERVAL '${ATTEMPT_WINDOW_SEC} seconds'`,
    [actorId, actorType]
  );
  return parseInt(row?.cnt || '0', 10) >= MAX_ATTEMPTS_PER_WINDOW;
}

/**
 * Cleanup expired pending logins and old attempts (call periodically).
 */
export async function cleanupExpired(): Promise<void> {
  await query(`DELETE FROM totp_pending_logins WHERE expires_at < NOW() OR used = true`);
  await query(`DELETE FROM totp_attempts WHERE created_at < NOW() - INTERVAL '1 day'`);
}
