/**
 * App PIN hashing & verification.
 *
 * PIN is a 4-6 digit numeric secret stored as salted PBKDF2-SHA512.
 * Mirrors the password hashing scheme from users repository so we don't
 * introduce a new dependency or algorithm.
 *
 * Format on disk: `salt(hex):iterations:hash(hex)` — same shape as
 * password_hash. Easy to recognize and migrate later if needed.
 */
import crypto from 'crypto';

const PIN_PBKDF2_ITERATIONS = 600_000;

export function hashPin(pin: string): string {
  if (!/^[0-9]{4,6}$/.test(pin)) {
    throw new Error('PIN must be 4-6 numeric digits');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(pin, salt, PIN_PBKDF2_ITERATIONS, 64, 'sha512')
    .toString('hex');
  return `${salt}:${PIN_PBKDF2_ITERATIONS}:${hash}`;
}

export function verifyPin(pin: string, storedHash: string): boolean {
  if (!/^[0-9]{4,6}$/.test(pin)) return false;
  const parts = storedHash.split(':');
  if (parts.length !== 3) return false;
  const [salt, iterStr, hash] = parts;
  const iterations = parseInt(iterStr, 10);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  const verifyHash = crypto
    .pbkdf2Sync(pin, salt, iterations, 64, 'sha512')
    .toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verifyHash, 'hex'));
  } catch {
    return false;
  }
}
