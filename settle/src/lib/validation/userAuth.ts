/**
 * Shared field-level validators for the user-side login / register flow.
 *
 * Each helper returns null when the value is valid, or a short error message
 * suitable for inline display next to the input. Used by both
 *   - LandingPage.tsx (live "did the user fix this yet?" feedback)
 *   - useUserAuth.ts handleUserRegister (submit-time guard)
 *   - /api/auth/user POST register branch (server-side enforcement, the
 *     authoritative copy)
 *
 * Keeping all three sites in sync via a single source avoids the drift you
 * usually see where the client says "valid" but the server rejects.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Disallow any whitespace in passwords — accidental leading/trailing spaces
// from autofill / paste are a common silent gotcha.
const PASSWORD_HAS_SPACE = /\s/;

export const USER_PASSWORD_MIN_LEN = 6;
export const USER_PASSWORD_MAX_LEN = 24;
export const USER_USERNAME_MIN_LEN = 3;
export const USER_USERNAME_MAX_LEN = 20;
export const USER_EMAIL_MAX_LEN = 254; // RFC 5321 ceiling

export function validateUserUsername(raw: string): string | null {
  const username = raw.trim();
  if (!username) return 'Username is required';
  if (username.length < USER_USERNAME_MIN_LEN || username.length > USER_USERNAME_MAX_LEN) {
    return `Username must be ${USER_USERNAME_MIN_LEN}-${USER_USERNAME_MAX_LEN} characters`;
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return 'Letters, numbers, and underscores only';
  }
  return null;
}

export function validateUserEmail(raw: string): string | null {
  const email = raw.trim();
  if (!email) return 'Email is required';
  if (email.length > USER_EMAIL_MAX_LEN) return `Email must be ≤${USER_EMAIL_MAX_LEN} characters`;
  if (!EMAIL_REGEX.test(email)) return 'Enter a valid email address';
  return null;
}

export function validateUserPassword(raw: string): string | null {
  if (!raw) return 'Password is required';
  if (PASSWORD_HAS_SPACE.test(raw)) return 'Password cannot contain spaces';
  if (raw.length < USER_PASSWORD_MIN_LEN) {
    return `Password must be at least ${USER_PASSWORD_MIN_LEN} characters`;
  }
  if (raw.length > USER_PASSWORD_MAX_LEN) {
    return `Password must be at most ${USER_PASSWORD_MAX_LEN} characters`;
  }
  return null;
}
