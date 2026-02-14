/**
 * Order Expiry Worker (Core API)
 *
 * Monitors orders for expiration based on global 15-minute timeout.
 * Automatically cancels expired orders.
 */
import { query, logger, MOCK_MODE } from 'settlement-core';
import { config } from 'dotenv';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
config({ path: '../../settle/.env.local' });
config({ path: '../../settle/.env' });
// Env-configurable worker tuning
const POLL_INTERVAL_MS = parseInt(process.env.EXPIRY_POLL_MS || '10000', 10);
const BATCH_SIZE = parseInt(process.env.EXPIRY_BATCH_SIZE || '20', 10);
const SUMMARY_INTERVAL_TICKS = Math.max(1, Math.round(30000 / POLL_INTERVAL_MS));
let isRunning = false;
let pollTimer = null;
let tickCount = 0;
let totalExpired = 0;
// DB-error backoff state
let consecutiveErrors = 0;
const MAX_BACKOFF_MS = 60000;
/**
 * Expire a single order
 */
async function expireOrder(order) {
    try {
        logger.info('[Expiry] Expiring order', {
            orderId: order.id,
            orderNumber: order.order_number,
            status: order.status,
            expiresAt: order.expires_at,
        });
        // Determine if we need to refund escrow
        const hasEscrow = !!order.escrow_tx_hash;
        if (hasEscrow && MOCK_MODE) {
            // Refund escrow in mock mode
            const amount = parseFloat(String(order.crypto_amount));
            const isSellOrder = order.type === 'sell';
            const refundTo = isSellOrder ? order.user_id : order.merchant_id;
            const refundTable = isSellOrder ? 'users' : 'merchants';
            await query(`UPDATE ${refundTable} SET balance = balance + $1 WHERE id = $2`, [amount, refundTo]);
            logger.info('[Expiry] Refunded escrow', {
                orderId: order.id,
                amount,
                refundTo,
                table: refundTable,
            });
        }
        // Update order status to expired
        await query(`UPDATE orders
       SET status = 'expired',
           cancelled_at = NOW(),
           cancelled_by = 'system',
           cancellation_reason = 'Order expired (15 minute timeout)',
           order_version = order_version + 1
       WHERE id = $1`, [order.id]);
        // Create order_events record
        await query(`INSERT INTO order_events
       (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
            order.id,
            'status_changed_to_expired',
            'system',
            'expiry-worker',
            order.status,
            'expired',
            { reason: 'Order expired (15 minute timeout)' },
        ]);
        // Insert notification_outbox record
        await query(`INSERT INTO notification_outbox
       (order_id, event_type, payload, status)
       VALUES ($1, $2, $3, $4)`, [
            order.id,
            'ORDER_EXPIRED',
            JSON.stringify({
                orderId: order.id,
                userId: order.user_id,
                merchantId: order.merchant_id,
                status: 'expired',
                minimal_status: 'expired',
                previousStatus: order.status,
                updatedAt: new Date().toISOString(),
            }),
            'pending',
        ]);
        logger.info('[Expiry] Order expired successfully', {
            orderId: order.id,
            orderNumber: order.order_number,
        });
    }
    catch (error) {
        logger.error('[Expiry] Error expiring order', {
            errorCode: 'EXPIRY_ORDER_ERROR',
            orderId: order.id,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
/**
 * Process expired orders
 */
async function processBatch() {
    try {
        // Find orders that have expired
        const expiredOrders = await query(`SELECT id, order_number, status, user_id, merchant_id, crypto_amount, type, escrow_tx_hash, created_at, expires_at
       FROM orders
       WHERE status NOT IN ('completed', 'cancelled', 'expired', 'disputed')
       AND expires_at < NOW()
       ORDER BY expires_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`, [BATCH_SIZE]);
        if (expiredOrders.length === 0) {
            consecutiveErrors = 0;
            writeHeartbeat(0);
            return;
        }
        logger.info(`[Expiry] Found ${expiredOrders.length} expired orders to process`);
        for (const order of expiredOrders) {
            await expireOrder(order);
        }
        totalExpired += expiredOrders.length;
        consecutiveErrors = 0;
        writeHeartbeat(expiredOrders.length);
    }
    catch (error) {
        consecutiveErrors++;
        const backoff = Math.min(POLL_INTERVAL_MS * Math.pow(2, consecutiveErrors), MAX_BACKOFF_MS);
        logger.error('[Expiry] Error processing batch', {
            errorCode: 'EXPIRY_BATCH_ERROR',
            consecutiveErrors,
            backoffMs: backoff,
            error: error instanceof Error ? error.message : String(error),
        });
        await new Promise(resolve => setTimeout(resolve, backoff - POLL_INTERVAL_MS));
    }
}
function writeHeartbeat(batchSize) {
    try {
        writeFileSync('/tmp/bm-worker-expiry.json', JSON.stringify({
            lastRun: new Date().toISOString(),
            totalExpired,
            lastBatchSize: batchSize,
        }));
    }
    catch { /* non-critical */ }
}
/**
 * Start the expiry worker
 */
export function startExpiryWorker() {
    if (isRunning) {
        logger.warn('[Expiry] Worker already running');
        return;
    }
    isRunning = true;
    logger.info('[Expiry] Starting order expiry worker', {
        pollInterval: POLL_INTERVAL_MS,
        batchSize: BATCH_SIZE,
    });
    const poll = async () => {
        if (!isRunning)
            return;
        await processBatch();
        tickCount++;
        // Summary log every 30s
        if (tickCount % SUMMARY_INTERVAL_TICKS === 0) {
            try {
                const stats = await query(`SELECT count(*)::text as count
           FROM orders
           WHERE status NOT IN ('completed', 'cancelled', 'expired', 'disputed')
             AND expires_at < NOW()`);
                logger.info('[Expiry] Summary', {
                    totalExpired,
                    currentlyExpirable: parseInt(stats[0]?.count || '0', 10),
                });
            }
            catch { /* non-critical */ }
        }
        pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    };
    poll();
}
/**
 * Stop the expiry worker
 */
export function stopExpiryWorker() {
    isRunning = false;
    if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
    logger.info('[Expiry] Stopped order expiry worker');
}
// If running as standalone script (ESM-compatible check)
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
    startExpiryWorker();
    process.on('SIGINT', () => {
        logger.info('[Expiry] Received SIGINT, shutting down...');
        stopExpiryWorker();
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        logger.info('[Expiry] Received SIGTERM, shutting down...');
        stopExpiryWorker();
        process.exit(0);
    });
}
