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

// Disallow any whitespace in passwords — accidental leading/trailing spaces
// from autofill / paste are a common silent gotcha.
const PASSWORD_HAS_SPACE = /\s/;

export const USER_PASSWORD_MIN_LEN = 6;
export const USER_PASSWORD_MAX_LEN = 24;
export const USER_USERNAME_MIN_LEN = 4;
export const USER_USERNAME_MAX_LEN = 20;

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

// First-time setup uses a 6-digit numeric PIN. Stored server-side via the
// same password hash field, so it passes validateUserPassword too.
export const USER_PIN_LENGTH = 6;
const PIN_DIGITS_ONLY = /^\d+$/;

export function validateUserPin(raw: string): string | null {
  if (!raw) return 'PIN is required';
  if (!PIN_DIGITS_ONLY.test(raw)) return 'PIN must be digits only';
  if (raw.length !== USER_PIN_LENGTH) return `PIN must be ${USER_PIN_LENGTH} digits`;
  return null;
}
