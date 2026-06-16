/**
 * Human-friendly order reference for UI display.
 *
 * The DB id is a UUID — unreadable to users. We surface a short, branded
 * reference instead: `BM-YYMMDD-XXXX`, where the date is the order's creation
 * day and the suffix is the last 4 alphanumeric chars of the UUID (uppercased).
 *
 * This is DISPLAY-ONLY. It is not unique on its own (the 4-char suffix can
 * collide) and must never be used as a key, lookup, or API parameter — always
 * pass the real `orderId` to the backend.
 */
export function getDisplayOrderId(
  orderId: string | null | undefined,
  createdAt: Date,
): string {
  const yy = String(createdAt.getFullYear()).slice(-2);
  const mm = String(createdAt.getMonth() + 1).padStart(2, '0');
  const dd = String(createdAt.getDate()).padStart(2, '0');
  const suffix =
    (orderId || '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(-4)
      .toUpperCase()
      .padStart(4, '0') || 'XXXX';
  return `BM-${yy}${mm}${dd}-${suffix}`;
}
