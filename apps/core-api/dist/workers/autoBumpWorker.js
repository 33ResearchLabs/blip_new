/**
 * Auto-Bump Worker (Core API)
 *
 * Periodically bumps priority on orders with auto_bump_enabled.
 * Increments premium_bps_current by bump_step_bps every bump_interval_sec.
 */
import { query as dbQuery, logger } from 'settlement-core';
import { broadcastOrderEvent } from '../ws/broadcast';
import { writeFileSync } from 'fs';
const POLL_INTERVAL_MS = parseInt(process.env.AUTO_BUMP_POLL_MS || '10000', 10);
let isRunning = false;
let pollTimer = null;
let totalBumps = 0;
async function processAutoBumps() {
    try {
        // Find orders ready for auto-bump
        const orders = await dbQuery(`SELECT id, premium_bps_current, premium_bps_cap, bump_step_bps, bump_interval_sec
       FROM orders
       WHERE auto_bump_enabled = TRUE
         AND status = 'pending'
         AND next_bump_at IS NOT NULL
         AND next_bump_at <= NOW()
         AND premium_bps_current < premium_bps_cap`, []);
        if (orders.length === 0)
            return;
        for (const order of orders) {
            try {
                const newPremium = Math.min(order.premium_bps_current + order.bump_step_bps, order.premium_bps_cap);
                const maxReached = newPremium >= order.premium_bps_cap;
                const nextBumpAt = !maxReached
                    ? new Date(Date.now() + order.bump_interval_sec * 1000).toISOString()
                    : null;
                await dbQuery(`UPDATE orders
           SET premium_bps_current = $1,
               next_bump_at = $2,
               updated_at = NOW()
           WHERE id = $3`, [newPremium, nextBumpAt, order.id]);
                totalBumps++;
                logger.info('[AutoBump] Order bumped', {
                    orderId: order.id,
                    oldBps: order.premium_bps_current,
                    newBps: newPremium,
                    maxReached,
                });
                // Broadcast so frontends see updated premium
                broadcastOrderEvent({
                    event_type: 'ORDER_BUMPED',
                    order_id: order.id,
                    status: 'pending',
                    minimal_status: 'pending',
                    order_version: 0,
                    premium_bps_current: newPremium,
                    max_reached: maxReached,
                });
            }
            catch (err) {
                logger.error('[AutoBump] Failed to bump order', {
                    orderId: order.id,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        writeHeartbeat(orders.length);
    }
    catch (err) {
        logger.error('[AutoBump] Worker error', {
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
function writeHeartbeat(batchSize) {
    try {
        writeFileSync('/tmp/bm-worker-autobump.json', JSON.stringify({
            lastRun: new Date().toISOString(),
            totalBumps,
            lastBatchSize: batchSize,
        }));
    }
    catch { /* non-critical */ }
}
export function startAutoBumpWorker() {
    if (isRunning)
        return;
    isRunning = true;
    logger.info('[AutoBump] Starting auto-bump worker', { pollInterval: POLL_INTERVAL_MS });
    const poll = async () => {
        if (!isRunning)
            return;
        await processAutoBumps();
        pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    };
    poll();
}
export function stopAutoBumpWorker() {
    isRunning = false;
    if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
    logger.info('[AutoBump] Stopped auto-bump worker');
}
