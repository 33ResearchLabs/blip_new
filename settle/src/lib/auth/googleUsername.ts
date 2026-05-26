/**
 * Username derivation for the Google OAuth signup path ONLY.
 *
 * The existing waitlist password-register helper (deriveUsernameFromEmail in
 * settle/src/components/waitlist/RegisterForm.tsx) uses just the email's
 * local part: foo@x.com -> "foo". That collides across all foo@* addresses.
 *
 * The Google path uses the FULL email so each verified Google identity gets
 * a globally-unique username on first signup:
 *
 *   foo@x.com               -> foo_x_com
 *   john.doe@gmail.com      -> john_doe_gmail_com
 *   verylongname@gmail.com  -> verylongname_gmail_c  (truncated to 20)
 *
 * Output must satisfy validateUserUsername in
 * settle/src/lib/validation/userAuth.ts:
 *   - 3-20 characters
 *   - [a-zA-Z0-9_] (we emit lowercase + digits + underscore)
 *
 * On rare exact collision (two long emails truncating to the same 20 chars,
 * or a username that happens to already exist from a non-Google signup),
 * we append "_2", "_3", ... until unique, keeping total length within 20.
 */

import { USER_USERNAME_MAX_LEN, USER_USERNAME_MIN_LEN } from '@/lib/validation/userAuth';

const MAX_SUFFIX_TRIES = 50;

function sanitizeFullEmail(email: string): string {
  return email
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function clampToMax(s: string): string {
  if (s.length <= USER_USERNAME_MAX_LEN) return s;
  return s.slice(0, USER_USERNAME_MAX_LEN).replace(/_+$/g, '');
}

function padToMin(s: string): string {
  if (s.length >= USER_USERNAME_MIN_LEN) return s;
  return (s + '_user').slice(0, USER_USERNAME_MAX_LEN);
}

export function deriveUsernameFromFullEmail(email: string): string {
  const sanitized = sanitizeFullEmail(email) || 'user';
  return padToMin(clampToMax(sanitized));
}

export async function deriveUniqueGoogleUsername(
  email: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const base = deriveUsernameFromFullEmail(email);
  if (!(await isTaken(base))) return base;

  for (let i = 2; i <= MAX_SUFFIX_TRIES; i++) {
    const suffix = `_${i}`;
    const trimmed = base.slice(0, USER_USERNAME_MAX_LEN - suffix.length).replace(/_+$/g, '');
    if (trimmed.length < USER_USERNAME_MIN_LEN - suffix.length) continue;
    const candidate = `${trimmed}${suffix}`;
    if (candidate.length >= USER_USERNAME_MIN_LEN && !(await isTaken(candidate))) {
      return candidate;
    }
  }

  for (let i = 0; i < 10; i++) {
    const rand = Math.random().toString(36).slice(2, 8);
    const candidate = `g_${rand}`;
    if (candidate.length >= USER_USERNAME_MIN_LEN && !(await isTaken(candidate))) {
      return candidate;
    }
  }

  throw new Error('Could not generate a unique username for Google signup');
}
