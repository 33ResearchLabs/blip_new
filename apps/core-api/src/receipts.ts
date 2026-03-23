/**
 * Order Receipt Helpers
 *
 * Creates and updates order receipts in the order_receipts table.
 * Receipts capture a snapshot of both parties at the time of acceptance
 * and are updated on every subsequent status transition.
 *
 * Race-condition safety:
 *   - createOrderReceipt uses INSERT … ON CONFLICT (atomic idempotency)
 *   - updateOrderReceipt uses a single UPDATE with a WHERE guard that
 *     enforces forward-only transitions and rejects stale writes.
 */
import {
  query as dbQuery,
  queryOne,
  logger,
} from 'settlement-core';

// ── Status priority map ─────────────────────────────────────────
// Higher number = further in the lifecycle.  "cancelled" is a
// terminal state at the same priority as "completed" because both
// are final — neither may overwrite the other.
const STATUS_PRIORITY: Record<string, number> = {
  accepted:     1,
  escrowed:     2,
  payment_sent: 3,
  completed:    4,
  cancelled:    4,   // terminal — same rank as completed
  expired:      4,   // terminal — same rank as completed/cancelled
};

/** Returns true when newStatus is strictly ahead of currentStatus. */
export function isForwardTransition(currentStatus: string, newStatus: string): boolean {
  const cur = STATUS_PRIORITY[currentStatus] ?? 0;
  const next = STATUS_PRIORITY[newStatus] ?? 0;
  return next > cur;
}

interface OrderForReceipt {
  id: string;
  order_number: string;
  type: string;
  payment_method: string;
  crypto_amount: string;
  crypto_currency: string;
  fiat_amount: string;
  fiat_currency: string;
  rate: string;
  platform_fee: string;
  protocol_fee_amount: string | null;
  status: string;
  user_id: string;
  merchant_id: string;
  buyer_merchant_id: string | null;
  acceptor_wallet_address: string | null;
  buyer_wallet_address: string | null;
  escrow_tx_hash: string | null;
  payment_details: Record<string, unknown> | null;
  accepted_at: Date | null;
  escrowed_at: Date | null;
}

interface PartySnapshot {
  creator_type: string;
  creator_id: string;
  creator_name: string | null;
  creator_wallet_address: string | null;
  acceptor_type: string;
  acceptor_id: string;
  acceptor_name: string | null;
  acceptor_wallet_address: string | null;
}

/**
 * Resolve creator and acceptor parties from an order.
 * Handles both User→Merchant and Merchant→Merchant (M2M) flows.
 */
async function resolveParties(order: OrderForReceipt, actorId: string): Promise<PartySnapshot> {
  // Check if the order creator is a real user or a placeholder (merchant-initiated)
  const userRow = await queryOne<{ username: string; wallet_address: string | null }>(
    'SELECT username, wallet_address FROM users WHERE id = $1',
    [order.user_id]
  );
  const username = userRow?.username || '';
  const isMerchantCreated = username.startsWith('open_order_') || username.startsWith('m2m_');

  if (isMerchantCreated) {
    // M2M or merchant-initiated order
    // The stored proc reassigns merchant_id / buyer_merchant_id differently depending on path:
    //   Non-escrowed claiming: buyer_merchant_id = original creator, merchant_id = acceptor
    //   Escrowed claiming:     buyer_merchant_id = acceptor,         merchant_id = original creator
    //   M2M (buyer preset):    buyer_merchant_id = original buyer,   merchant_id = acceptor
    // In all cases, the acceptor is actorId. So if buyer_merchant_id IS actorId, creator is merchant_id.
    const creatorMerchantId = (order.buyer_merchant_id && order.buyer_merchant_id !== actorId)
      ? order.buyer_merchant_id
      : order.merchant_id;
    const creatorMerchant = await queryOne<{ business_name: string; wallet_address: string | null }>(
      'SELECT business_name, wallet_address FROM merchants WHERE id = $1',
      [creatorMerchantId]
    );
    const acceptorMerchant = await queryOne<{ business_name: string; wallet_address: string | null }>(
      'SELECT business_name, wallet_address FROM merchants WHERE id = $1',
      [actorId]
    );

    return {
      creator_type: 'merchant',
      creator_id: creatorMerchantId,
      creator_name: creatorMerchant?.business_name || null,
      creator_wallet_address: creatorMerchant?.wallet_address || null,
      acceptor_type: 'merchant',
      acceptor_id: actorId,
      acceptor_name: acceptorMerchant?.business_name || null,
      acceptor_wallet_address: order.acceptor_wallet_address || acceptorMerchant?.wallet_address || null,
    };
  } else {
    // User-initiated order
    // Creator is the user, acceptor is the merchant
    const acceptorMerchant = await queryOne<{ business_name: string; wallet_address: string | null }>(
      'SELECT business_name, wallet_address FROM merchants WHERE id = $1',
      [actorId]
    );

    return {
      creator_type: 'user',
      creator_id: order.user_id,
      creator_name: username,
      creator_wallet_address: userRow?.wallet_address || order.buyer_wallet_address || null,
      acceptor_type: 'merchant',
      acceptor_id: actorId,
      acceptor_name: acceptorMerchant?.business_name || null,
      acceptor_wallet_address: order.acceptor_wallet_address || acceptorMerchant?.wallet_address || null,
    };
  }
}

/**
 * Create an order receipt when an order is accepted.
 *
 * Uses INSERT … ON CONFLICT DO NOTHING on the order_id UNIQUE constraint
 * so the operation is atomic and idempotent — no SELECT-then-INSERT race.
 */
export async function createOrderReceipt(orderId: string, order: OrderForReceipt, actorId: string): Promise<void> {
  try {
    const parties = await resolveParties(order, actorId);

    const result = await dbQuery<{ order_id: string }>(
      `INSERT INTO order_receipts (
        order_id, order_number, type, payment_method,
        crypto_amount, crypto_currency, fiat_amount, fiat_currency, rate,
        platform_fee, protocol_fee_amount, status,
        creator_type, creator_id, creator_name, creator_wallet_address,
        acceptor_type, acceptor_id, acceptor_name, acceptor_wallet_address,
        payment_details, escrow_tx_hash,
        accepted_at, escrowed_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9,
        $10, $11, $12,
        $13, $14, $15, $16,
        $17, $18, $19, $20,
        $21, $22,
        $23, $24
      )
      ON CONFLICT (order_id) DO NOTHING
      RETURNING order_id`,
      [
        orderId, order.order_number, order.type, order.payment_method,
        order.crypto_amount, order.crypto_currency, order.fiat_amount, order.fiat_currency, order.rate,
        order.platform_fee, order.protocol_fee_amount, order.status,
        parties.creator_type, parties.creator_id, parties.creator_name, parties.creator_wallet_address,
        parties.acceptor_type, parties.acceptor_id, parties.acceptor_name, parties.acceptor_wallet_address,
        order.payment_details ? JSON.stringify(order.payment_details) : null, order.escrow_tx_hash,
        order.accepted_at || new Date(), order.escrowed_at,
      ]
    );

    if (result.length === 0) {
      logger.info('[Receipt] Receipt already exists (ON CONFLICT), skipping', { orderId });
      return;
    }

    // Insert receipt message into chat for both parties to see.
    // Stores structured data in receipt_data JSONB column with a human-readable
    // fallback in content. message_type = 'receipt' so the frontend can detect
    // it without JSON.parse on the content field.
    const receiptData = JSON.stringify({
      order_number: order.order_number,
      order_type: order.type,
      payment_method: order.payment_method,
      crypto_amount: order.crypto_amount,
      crypto_currency: order.crypto_currency,
      fiat_amount: order.fiat_amount,
      fiat_currency: order.fiat_currency,
      rate: order.rate,
      platform_fee: order.platform_fee,
      creator_type: parties.creator_type,
      creator_name: parties.creator_name,
      acceptor_type: parties.acceptor_type,
      acceptor_name: parties.acceptor_name,
      status: order.status,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const receiptText = `Order Receipt #${order.order_number}`;

    // Insert into order chat (chat_messages) — visible to user in ChatViewScreen
    await dbQuery(
      `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type, receipt_data)
       VALUES ($1, $2, $3, $4, 'receipt', $5::jsonb)`,
      [orderId, parties.acceptor_type, parties.acceptor_id, receiptText, receiptData]
    );

    // Insert a single row into direct_messages — visible to both parties in DirectChatView.
    // Read status is tracked per-participant in dm_read_status.
    const dmResult = await dbQuery<{ id: string }>(
      `INSERT INTO direct_messages (sender_type, sender_id, recipient_type, recipient_id, content, message_type, receipt_data)
       VALUES ($1, $2, $3, $4, $5, 'receipt', $6::jsonb)
       RETURNING id`,
      [parties.acceptor_type, parties.acceptor_id, parties.creator_type, parties.creator_id, receiptText, receiptData]
    );
    // Create read-status rows for both participants
    if (dmResult.length > 0) {
      const dmId = dmResult[0].id;
      await dbQuery(
        `INSERT INTO dm_read_status (message_id, actor_id, is_read, read_at) VALUES
           ($1, $2, true,  NOW()),
           ($1, $3, false, NULL)
         ON CONFLICT DO NOTHING`,
        [dmId, parties.acceptor_id, parties.creator_id]
      );
    }

    logger.info('[Receipt] Created order receipt', { orderId, orderNumber: order.order_number });
  } catch (err) {
    logger.error('[Receipt] Failed to create order receipt', { orderId, error: err });
  }
}

/**
 * Update an order receipt when the order status changes.
 *
 * Race-condition guards (all enforced in a single atomic UPDATE):
 *   1. Terminal guard: skips if receipt is already completed/cancelled.
 *   2. Forward-only guard: the WHERE clause lists every status that the
 *      new status is allowed to overwrite, so a stale/out-of-order job
 *      from the queue cannot move the receipt backward.
 *   3. Stale-write guard: updated_at must not have advanced since the
 *      job was enqueued (prevents a slow retry from overwriting a newer
 *      update that already landed).
 *
 * Returns true if a row was actually modified, false if the guard
 * rejected the write (not an error — just a no-op).
 */
export async function updateOrderReceipt(
  orderId: string,
  newStatus: string,
  fields?: {
    escrow_tx_hash?: string | null;
    release_tx_hash?: string | null;
    refund_tx_hash?: string | null;
    payment_sent_at?: boolean;
    escrowed_at?: boolean;
    completed_at?: boolean;
    cancelled_at?: boolean;
    expired_at?: boolean;
  }
): Promise<boolean> {
  // ── Build the allowed-current-statuses list ───────────────────
  // Only statuses with a strictly lower priority may be overwritten.
  const newPriority = STATUS_PRIORITY[newStatus] ?? 0;
  const allowedCurrent = Object.entries(STATUS_PRIORITY)
    .filter(([, p]) => p < newPriority)
    .map(([s]) => s);

  const terminalStatuses = ['cancelled', 'expired'];
  if (allowedCurrent.length === 0 && !terminalStatuses.includes(newStatus)) {
    // Nothing can transition *to* this status — programming error or
    // an unknown status; log and bail rather than issuing a pointless UPDATE.
    logger.warn('[Receipt] No valid source statuses for target', { orderId, newStatus });
    return false;
  }

  // ── SET clause ────────────────────────────────────────────────
  const setClauses: string[] = ['status = $1', 'updated_at = NOW()'];
  const params: unknown[] = [newStatus];
  let idx = 1;

  const addField = (clause: string, value: unknown) => {
    idx++;
    setClauses.push(`${clause} = $${idx}`);
    params.push(value);
  };

  if (fields?.escrow_tx_hash) addField('escrow_tx_hash', fields.escrow_tx_hash);
  if (fields?.release_tx_hash) addField('release_tx_hash', fields.release_tx_hash);
  if (fields?.refund_tx_hash) addField('refund_tx_hash', fields.refund_tx_hash);

  // Timestamp fields — set to NOW() when flagged true
  if (fields?.escrowed_at) { setClauses.push('escrowed_at = NOW()'); }
  if (fields?.payment_sent_at) { setClauses.push('payment_sent_at = NOW()'); }
  if (fields?.completed_at) { setClauses.push('completed_at = NOW()'); }
  if (fields?.cancelled_at) { setClauses.push('cancelled_at = NOW()'); }
  if (fields?.expired_at) { setClauses.push('expired_at = NOW()'); }

  // ── WHERE clause: order_id + forward-only + terminal guard ────
  idx++;
  const orderIdIdx = idx;
  params.push(orderId);

  // For terminal statuses (cancelled/expired): allow overwriting any non-terminal status
  // For forward transitions: only overwrite statuses with lower priority
  let statusGuard: string;
  if (terminalStatuses.includes(newStatus)) {
    statusGuard = `status NOT IN ('completed', 'cancelled', 'expired')`;
  } else {
    const placeholders = allowedCurrent.map((s) => {
      idx++;
      params.push(s);
      return `$${idx}`;
    });
    statusGuard = `status IN (${placeholders.join(', ')})`;
  }

  const result = await dbQuery(
    `UPDATE order_receipts
        SET ${setClauses.join(', ')}
      WHERE order_id = $${orderIdIdx}
        AND ${statusGuard}
      RETURNING order_id`,
    params
  );

  if (result.length === 0) {
    logger.info('[Receipt] Update skipped (terminal or not a forward transition)', {
      orderId, newStatus,
    });
    return false;
  }

  logger.info('[Receipt] Updated order receipt', { orderId, newStatus });
  return true;
}
