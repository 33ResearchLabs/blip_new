/**
 * Receipt Listener
 *
 * Creates receipts on acceptance OR on creation-as-escrowed (SELL flow);
 * updates them on every subsequent transition.
 */
import { orderBus, ORDER_EVENT, type OrderEventPayload } from '../orderEvents';
import { enqueueCreateReceipt, enqueueUpdateReceipt } from '../../queues/receiptQueue';
import { logger } from 'settlement-core';

// Shared payload builder so the CREATED + ACCEPTED listeners stay in sync
// when fields are added to receipts later.
function buildReceiptPayload(o: Record<string, unknown>) {
  return {
    id: o.id as string,
    order_number: o.order_number as string,
    type: o.type as string,
    payment_method: o.payment_method as string,
    crypto_amount: o.crypto_amount as string,
    crypto_currency: o.crypto_currency as string,
    fiat_amount: o.fiat_amount as string,
    fiat_currency: o.fiat_currency as string,
    rate: o.rate as string,
    platform_fee: o.platform_fee as string,
    protocol_fee_amount: (o.protocol_fee_amount as string) ?? null,
    status: o.status as string,
    user_id: o.user_id as string,
    merchant_id: o.merchant_id as string,
    buyer_merchant_id: (o.buyer_merchant_id as string) ?? null,
    acceptor_wallet_address: (o.acceptor_wallet_address as string) ?? null,
    buyer_wallet_address: (o.buyer_wallet_address as string) ?? null,
    escrow_tx_hash: (o.escrow_tx_hash as string) ?? null,
    payment_details: (o.payment_details as Record<string, unknown>) ?? null,
    accepted_at: o.accepted_at ? new Date(o.accepted_at as string).toISOString() : null,
    escrowed_at: o.escrowed_at ? new Date(o.escrowed_at as string).toISOString() : null,
  };
}

export function registerReceiptListener(): void {
  // Create receipt when order is accepted (BUY flow: pending -> accepted)
  orderBus.safeOn(ORDER_EVENT.ACCEPTED, (p: OrderEventPayload) => {
    logger.info('[Receipt][debug] ACCEPTED listener fired', {
      orderId: p.orderId,
      orderNumber: p.order.order_number,
      type: p.order.type,
      status: p.order.status,
      previousStatus: p.previousStatus,
      newStatus: p.newStatus,
      actorId: p.actorId,
      actorType: p.actorType,
      userId: p.order.user_id,
      merchantId: p.order.merchant_id,
      buyerMerchantId: p.order.buyer_merchant_id,
    });
    const job = enqueueCreateReceipt(p.orderId, buildReceiptPayload(p.order), p.actorId);
    logger.info('[Receipt][debug] enqueueCreateReceipt(ACCEPTED) sync returned', {
      orderId: p.orderId,
      returnedNonNull: job !== null,
    });
    job
      .then((j: any) => {
        logger.info('[Receipt][debug] enqueueCreateReceipt(ACCEPTED) promise resolved', {
          orderId: p.orderId,
          jobId: j?.id ?? null,
          jobName: j?.name ?? null,
        });
      })
      .catch((err) => {
        logger.error('[ReceiptListener] Failed to enqueue receipt creation (ACCEPTED)', { orderId: p.orderId, error: String(err) });
      });
  });

  // Create receipt when order is CREATED already in `escrowed` status — this
  // is the SELL flow: the user funds escrow at creation time so the order
  // skips `pending`/`accepted` entirely and never fires ACCEPTED. Without
  // this listener, SELL orders never get receipts (subsequent UPDATE events
  // are no-ops because the row doesn't exist).
  //
  // The receipt queue dedupes via `jobId: create-receipt-${orderId}`, so if
  // ACCEPTED also fires later (it won't for SELL, but for safety) the second
  // create is silently ignored — no duplicate receipts.
  orderBus.safeOn(ORDER_EVENT.CREATED, (p: OrderEventPayload) => {
    const status = String(p.order.status || p.newStatus || '').toLowerCase();
    logger.info('[Receipt][debug] CREATED listener fired', {
      orderId: p.orderId,
      orderNumber: p.order.order_number,
      type: p.order.type,
      status,
      actorId: p.actorId,
      actorType: p.actorType,
      userId: p.order.user_id,
      merchantId: p.order.merchant_id,
      buyerMerchantId: p.order.buyer_merchant_id,
      willEnqueue: status === 'escrowed',
    });
    if (status !== 'escrowed') return; // BUY orders go pending -> accepted via ACCEPTED listener
    const job = enqueueCreateReceipt(p.orderId, buildReceiptPayload(p.order), p.actorId);
    logger.info('[Receipt][debug] enqueueCreateReceipt(CREATED-as-escrowed) sync returned', {
      orderId: p.orderId,
      returnedNonNull: job !== null,
    });
    job
      .then((j: any) => {
        logger.info('[Receipt][debug] enqueueCreateReceipt(CREATED-as-escrowed) promise resolved', {
          orderId: p.orderId,
          jobId: j?.id ?? null,
          jobName: j?.name ?? null,
        });
      })
      .catch((err) => {
        logger.error('[ReceiptListener] Failed to enqueue receipt creation (CREATED-as-escrowed)', { orderId: p.orderId, error: String(err) });
      });
  });

  // Update receipt on payment_sent
  orderBus.safeOn(ORDER_EVENT.PAYMENT_SENT, (p: OrderEventPayload) => {
    logger.info('[Receipt][debug] PAYMENT_SENT listener fired', { orderId: p.orderId, orderNumber: p.order.order_number });
    const job = enqueueUpdateReceipt(p.orderId, 'payment_sent', { payment_sent_at: true });
    logger.info('[Receipt][debug] enqueueUpdateReceipt(payment_sent) returned', { orderId: p.orderId, enqueued: job !== null });
    job?.catch((err) => logger.error('[ReceiptListener] Failed to enqueue payment_sent update', { orderId: p.orderId, error: String(err) }));
  });

  // Update receipt on completed (with release tx hash)
  orderBus.safeOn(ORDER_EVENT.COMPLETED, (p: OrderEventPayload) => {
    logger.info('[Receipt][debug] COMPLETED listener fired', { orderId: p.orderId, orderNumber: p.order.order_number });
    const job = enqueueUpdateReceipt(p.orderId, 'completed', {
      release_tx_hash: p.txHash ?? null,
      completed_at: true,
    });
    logger.info('[Receipt][debug] enqueueUpdateReceipt(completed) returned', { orderId: p.orderId, enqueued: job !== null });
    job?.catch((err) => logger.error('[ReceiptListener] Failed to enqueue completed update', { orderId: p.orderId, error: String(err) }));
  });

  // Update receipt on cancelled (with optional refund tx hash)
  orderBus.safeOn(ORDER_EVENT.CANCELLED, (p: OrderEventPayload) => {
    logger.info('[Receipt][debug] CANCELLED listener fired', {
      orderId: p.orderId,
      orderNumber: p.order.order_number,
      previousStatus: p.previousStatus,
      newStatus: p.newStatus,
      refundTxHash: p.refundTxHash ?? null,
    });
    const job = enqueueUpdateReceipt(p.orderId, 'cancelled', {
      refund_tx_hash: p.refundTxHash ?? null,
      cancelled_at: true,
    });
    logger.info('[Receipt][debug] enqueueUpdateReceipt(cancelled) returned', { orderId: p.orderId, enqueued: job !== null });
    job?.catch((err) => logger.error('[ReceiptListener] Failed to enqueue cancelled update', { orderId: p.orderId, error: String(err) }));
  });

  // Update receipt on expired
  orderBus.safeOn(ORDER_EVENT.EXPIRED, (p: OrderEventPayload) => {
    logger.info('[Receipt][debug] EXPIRED listener fired', { orderId: p.orderId, previousStatus: p.previousStatus });
    // Only accepted+ orders have receipts; pending orders do not
    if (p.previousStatus !== 'pending') {
      const job = enqueueUpdateReceipt(p.orderId, 'expired', { expired_at: true });
      logger.info('[Receipt][debug] enqueueUpdateReceipt(expired) returned', { orderId: p.orderId, enqueued: job !== null });
      job?.catch((err) => logger.error('[ReceiptListener] Failed to enqueue expired update', { orderId: p.orderId, error: String(err) }));
    } else {
      logger.info('[Receipt][debug] EXPIRED skipped — was pending (no receipt to update)', { orderId: p.orderId });
    }
  });

  // Generic handler for transitions handled by the general TX path
  // (escrowed, etc. — anything not caught by a specific listener above)
  orderBus.safeOn(ORDER_EVENT.ESCROWED, (p: OrderEventPayload) => {
    logger.info('[Receipt][debug] ESCROWED listener fired', { orderId: p.orderId, orderNumber: p.order.order_number });
    const job = enqueueUpdateReceipt(p.orderId, 'escrowed', { escrowed_at: true });
    logger.info('[Receipt][debug] enqueueUpdateReceipt(escrowed) returned', { orderId: p.orderId, enqueued: job !== null });
    job?.catch((err) => logger.error('[ReceiptListener] Failed to enqueue escrowed update', { orderId: p.orderId, error: String(err) }));
  });

  logger.info('[ReceiptListener] Registered');
}
