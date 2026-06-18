/**
 * Human-friendly order reference for UI display.
 *
 * ALWAYS prefer the real DB `order_number` (passed as the 3rd arg) — that is the
 * canonical, persisted id shown in lists, chat, the ledger, and used for support
 * lookups. Pass it whenever the order row is available so every surface shows the
 * SAME id.
 *
 * The `BM-YYMMDD-XXXX` form derived from (orderId, createdAt) is a DISPLAY-ONLY
 * FALLBACK for callers that don't have the row yet (e.g. the transient matching
 * screen). Its suffix is the last 4 alphanumeric chars of the UUID, which does
 * NOT match the DB `order_number` (built from a different part of the id) — so it
 * must never override a real `order_number`, and must never be used as a key,
 * lookup, or API parameter (always pass the real `orderId` to the backend).
 */
export function getDisplayOrderId(
  orderId: string | null | undefined,
  createdAt: Date,
  orderNumber?: string | null,
): string {
  // Canonical id wins whenever we have it.
  if (orderNumber && orderNumber.trim()) return orderNumber.trim();

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
