/**
 * Username derivation for the Google OAuth signup path ONLY.
 *
 * We use just the email's local part (everything before the "@") so the
 * username reads naturally and never leaks the provider domain:
 *
 *   girishavhad1@gmail.com  -> girishavhad1
 *   john.doe@gmail.com      -> john_doe          (dot -> underscore)
 *   john+shopping@gmail.com -> john              ("+tag" alias dropped)
 *   verylongnameherefoobar@gmail.com -> verylongnameherefoob  (truncated to 20)
 *
 * Output must satisfy validateUserUsername in
 * settle/src/lib/validation/userAuth.ts:
 *   - 4-20 characters
 *   - [a-zA-Z0-9_] (we emit lowercase + digits + underscore)
 *
 * Local parts are NOT unique across domains (foo@a.com and foo@b.com both
 * derive "foo"), and a name may already exist from a non-Google signup, so on
 * collision we append "_2", "_3", ... until unique, keeping length within 20.
 */

import { USER_USERNAME_MAX_LEN, USER_USERNAME_MIN_LEN } from '@/lib/validation/userAuth';

const MAX_SUFFIX_TRIES = 50;

function sanitizeEmailLocalPart(email: string): string {
  const localPart = email.split('@')[0] ?? ''; // girishavhad1@gmail.com -> girishavhad1
  return localPart
    .toLowerCase()
    .trim()
    .replace(/\+.*$/, '') // drop "+tag" alias: john+shopping -> john
    .replace(/[^a-z0-9]+/g, '_') // any leftover punctuation (e.g. dots) -> _
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
  const sanitized = sanitizeEmailLocalPart(email) || 'user';
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
