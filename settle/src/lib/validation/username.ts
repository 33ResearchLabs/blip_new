/**
 * Validate a username string.
 * Returns null if valid, or an error message string if invalid.
 * Shared between user and merchant auth routes.
 */
// Reserved words that cannot be used as usernames — protect brand identity.
const RESERVED = [
  'blip', 'blipmoney', 'blipapp', 'blip_money', 'blip_app',
  'blipsupport', 'blipceo', 'blipteam', 'blipofficial', 'bliphelp',
  'blip_support', 'blip_ceo', 'blip_team', 'blip_official', 'blip_help',
  'support', 'admin', 'help', 'official', 'team', 'staff', 'mod',
  'moderator', 'customercare', 'customer_care',
];

export function validateUsername(username: string): string | null {
  if (username.length < 4 || username.length > 20) {
    return 'Username must be 4-20 characters';
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return 'Username can only contain letters, numbers, and underscores';
  }
  if (RESERVED.includes(username.toLowerCase())) {
    return 'This username is reserved';
  }
  return null;
}
