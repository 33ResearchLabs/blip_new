/**
 * Validate a username string.
 * Returns null if valid, or an error message string if invalid.
 * Shared between user and merchant auth routes.
 */
export function validateUsername(username: string): string | null {
  if (username.length < 3 || username.length > 20) {
    return 'Username must be 3-20 characters';
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return 'Username can only contain letters, numbers, and underscores';
  }
  return null;
}
