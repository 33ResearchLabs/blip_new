/**
 * Close an ACTIVE appeal (open|proposed) when its order reaches a terminal state
 * through a NON-appeal path — e.g. the seller's on-chain release (which goes
 * through release_order_v1, not the appeal endpoint) or a manual cancel.
 *
 * Why this matters: escalateAppealToDispute (and the appeal-timeout worker that
 * calls it) guards `status IN ('accepted','escrowed','payment_sent')`. If an
 * order completed/cancelled while an appeal was still 'open'/'proposed', the
 * worker would try to escalate a terminal order every cycle and throw
 * ORDER_VERSION_CONFLICT forever. Closing the appeal here keeps the two in sync.
 *
 *   completed            → appeal 'resolved'
 *   cancelled / expired  → appeal 'cancelled'
 *
 * Idempotent: a no-op (returns null) when there is no active appeal. Pass a
 * transaction client to make it atomic with the terminal write; the pooled
 * `query` helper can be adapted via `{ query: async (t,p) => ({ rows: await query(t,p) }) }`.
 */
import { logger } from 'settlement-core';

type TxClient = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export async function closeActiveAppealForTerminalOrder(
  client: TxClient,
  orderId: string,
  terminalStatus: string,
): Promise<string | null> {
  const appealStatus = terminalStatus === 'completed' ? 'resolved' : 'cancelled';
  const res = await client.query(
    `UPDATE appeals
        SET status = $2::appeal_status, resolved_at = NOW(), updated_at = NOW()
      WHERE order_id = $1 AND status IN ('open', 'proposed')
      RETURNING id`,
    [orderId, appealStatus],
  );
  if (res.rows.length === 0) return null;

  await client.query(
    `UPDATE orders SET appeal_status = NULL, appeal_deadline = NULL WHERE id = $1`,
    [orderId],
  );

  const msg =
    terminalStatus === 'completed'
      ? '✅ The open appeal was closed — the seller released the crypto to the buyer and the order is now complete. No further action is needed.'
      : '✅ The open appeal was closed — the order was cancelled and the escrow refunded to the seller. No further action is needed.';
  // system-sender 'text' so it renders inline in the chat thread (see appeal.ts).
  await client.query(
    `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type)
     VALUES ($1, 'system', $1, $2, 'text')`,
    [orderId, msg],
  );

  logger.info('[Appeal] Auto-closed on terminal order', { orderId, terminalStatus, appealStatus });
  return res.rows[0].id as string;
}
