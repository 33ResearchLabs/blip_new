/**
 * Format a last-seen timestamp into a human-readable string.
 *
 * Returns:
 *  - "online"                          — if isOnline is true
 *  - "last seen just now"              — < 1 minute ago
 *  - "last seen 5 minutes ago"         — < 1 hour ago
 *  - "last seen 2 hours ago"           — < 24 hours ago
 *  - "last seen yesterday at 3:42 PM"  — yesterday
 *  - "last seen Apr 12 at 3:42 PM"    — older
 *  - ""                                — if no data available
 */

export function formatLastSeen(
  isOnline: boolean,
  lastSeen: string | null,
): string {
  if (isOnline) return 'online';
  if (!lastSeen) return '';

  const now = Date.now();
  const seen = new Date(lastSeen).getTime();
  const diffMs = now - seen;

  if (isNaN(seen)) return '';

  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);

  if (diffMin < 1) return 'last seen just now';
  if (diffMin < 60) return `last seen ${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  if (diffHr < 24) return `last seen ${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;

  const seenDate = new Date(lastSeen);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const timeStr = seenDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (seenDate.toDateString() === yesterday.toDateString()) {
    return `last seen yesterday at ${timeStr}`;
  }

  const dateStr = seenDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `last seen ${dateStr} at ${timeStr}`;
}
