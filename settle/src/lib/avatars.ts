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

/**
 * 50 pre-made avatar options for the profile avatar pickers (user + merchant).
 * Five DiceBear styles × 10 seeds each. Mirrors the list the merchant profile
 * modal has used since launch — kept here so both pickers share one source.
 */
export const PRESET_AVATARS: string[] = [
  // Adventurer style (10)
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Felix',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Aneka',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Max',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Luna',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Charlie',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Bella',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Oliver',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Milo',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Sophie',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Leo',

  // Avataaars style (10)
  'https://api.dicebear.com/7.x/avataaars/svg?seed=John',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Mike',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Emma',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=David',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Alice',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Tom',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Kate',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=James',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Lily',

  // Bottts style (10)
  'https://api.dicebear.com/7.x/bottts/svg?seed=Robot1',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Robot2',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Robot3',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Robot4',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Robot5',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Bot6',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Bot7',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Bot8',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Bot9',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Bot10',

  // Pixel Art style (10)
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Pixel1',
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Pixel2',
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Pixel3',
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Pixel4',
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Pixel5',
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Game1',
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Game2',
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Game3',
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Game4',
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Game5',

  // Lorelei style (10)
  'https://api.dicebear.com/7.x/lorelei/svg?seed=Anna',
  'https://api.dicebear.com/7.x/lorelei/svg?seed=Ben',
  'https://api.dicebear.com/7.x/lorelei/svg?seed=Clara',
  'https://api.dicebear.com/7.x/lorelei/svg?seed=Dan',
  'https://api.dicebear.com/7.x/lorelei/svg?seed=Eva',
  'https://api.dicebear.com/7.x/lorelei/svg?seed=Frank',
  'https://api.dicebear.com/7.x/lorelei/svg?seed=Grace',
  'https://api.dicebear.com/7.x/lorelei/svg?seed=Henry',
  'https://api.dicebear.com/7.x/lorelei/svg?seed=Iris',
  'https://api.dicebear.com/7.x/lorelei/svg?seed=Jack',
];
