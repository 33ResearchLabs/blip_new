/**
 * Notification milestone keys (panel dedup).
 *
 * One order lifecycle transition can be written to the notification panel by
 * MULTIPLE independent paths, each with its own wording:
 *   - optimistic: the action hook calls addNotification right after the API
 *     succeeds (e.g. "Order completed - 10 USDT released to buyer"), and
 *   - realtime: the Pusher status event handler calls addNotification when the
 *     event lands (e.g. "Trade completed! 10 USDT · TraderKing"), and
 *   - history: the panel reloads past events from the DB on login.
 *
 * Because the messages differ, a dedup keyed on the message text can't collapse
 * them, so the user sees 2-3 cards for one action. These helpers derive a
 * stable per-transition key — (orderId, milestone) — so the panel keeps exactly
 * one notification per milestone regardless of which path created it or how it
 * was worded.
 *
 * `null` is returned when no stable milestone can be derived (no orderId, or a
 * transient/error message with no lifecycle status). Callers fall back to the
 * existing message-based dedup in that case — so non-milestone notifications
 * (wallet errors, progress messages, chat, expiry warnings) are unaffected.
 */

export type NotifMilestone =
  | 'created'
  | 'accepted'
  | 'escrowed'
  | 'payment_sent'
  | 'payment_confirmed'
  | 'settled'
  | 'cancelled'
  | 'expired'
  | 'disputed';

/**
 * Map a raw order status to its canonical panel milestone. Adjacent statuses
 * that represent the SAME user-perceived event are folded together — notably
 * releasing / released / completed → 'settled' — so the "Escrow Released" and
 * "Trade Complete" notifications for one settlement collapse into one.
 */
export function notifMilestone(status: string | null | undefined): NotifMilestone | null {
  switch ((status || '').toLowerCase()) {
    case 'pending':
    case 'open':
    case 'created':
      return 'created';
    case 'accepted':
    case 'matched':
      return 'accepted';
    case 'escrowed':
    case 'escrow_locked':
    case 'locked':
      return 'escrowed';
    case 'payment_sent':
    case 'paid':
      return 'payment_sent';
    case 'payment_confirmed':
      return 'payment_confirmed';
    case 'releasing':
    case 'released':
    case 'complete':
    case 'completed':
      return 'settled';
    case 'cancelled':
    case 'canceled':
    case 'refunded':
      return 'cancelled';
    case 'expired':
      return 'expired';
    case 'disputed':
      return 'disputed';
    default:
      return null;
  }
}

/** Map the DB notification event_type (history load) to a raw status string. */
export function eventTypeToStatus(eventType: string | null | undefined): string | null {
  switch (eventType) {
    case 'ORDER_CREATED': return 'created';
    case 'ORDER_ACCEPTED': return 'accepted';
    case 'ORDER_ESCROWED': return 'escrowed';
    case 'ORDER_PAYMENT_SENT': return 'payment_sent';
    case 'ORDER_PAYMENT_CONFIRMED': return 'payment_confirmed';
    case 'ORDER_COMPLETED': return 'completed';
    case 'ORDER_CANCELLED': return 'cancelled';
    case 'ORDER_EXPIRED': return 'expired';
    case 'ORDER_DISPUTED': return 'disputed';
    default: return null;
  }
}

/**
 * Build the stable per-order dedup key for a milestone notification, or null
 * when one can't be formed (missing orderId or non-lifecycle status). When
 * null, the caller keeps its existing message-based dedup.
 */
export function milestoneDedupeKey(
  orderId: string | undefined | null,
  status: string | null | undefined,
): string | null {
  if (!orderId) return null;
  const m = notifMilestone(status);
  if (!m) return null;
  return `${orderId}|${m}`;
}
