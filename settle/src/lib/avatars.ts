/**
 * Deterministic default avatars for new users / merchants.
 *
 * Uses DiceBear (already CSP-allowed in middleware.ts and used by the
 * avatar picker on /merchant/settings). Seeding by a stable identifier
 * (username, email) means the same user always renders the same avatar
 * across sessions and devices, with no DB migration required when the
 * style changes — the URL is computed from the seed.
 */

const STYLE = 'adventurer';
const VERSION = '7.x';

export function defaultAvatarUrl(seed: string | null | undefined): string {
  const safe = encodeURIComponent((seed && seed.trim()) || 'anonymous');
  return `https://api.dicebear.com/${VERSION}/${STYLE}/svg?seed=${safe}`;
}
