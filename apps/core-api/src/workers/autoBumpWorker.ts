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
let pollTimer: NodeJS.Timeout | null = null;
let totalBumps = 0;

async function processAutoBumps(): Promise<void> {
  try {
    // Find orders ready for auto-bump (SKIP LOCKED prevents multi-instance double-bump)
    const orders = await dbQuery<{
      id: string;
      order_version: number;
      premium_bps_current: number;
      premium_bps_cap: number;
      bump_step_bps: number;
      bump_interval_sec: number;
    }>(
      `SELECT id, order_version, premium_bps_current, premium_bps_cap, bump_step_bps, bump_interval_sec
       FROM orders
       WHERE auto_bump_enabled = TRUE
         AND status = 'pending'
         AND next_bump_at IS NOT NULL
         AND next_bump_at <= NOW()
         AND premium_bps_current < premium_bps_cap
       FOR UPDATE SKIP LOCKED`,
      []
    );

    if (orders.length === 0) return;

    for (const order of orders) {
      try {
        const newPremium = Math.min(
          order.premium_bps_current + order.bump_step_bps,
          order.premium_bps_cap
        );
        const maxReached = newPremium >= order.premium_bps_cap;
        const nextBumpAt = !maxReached
          ? new Date(Date.now() + order.bump_interval_sec * 1000).toISOString()
          : null;

        // Version + status guard prevents double-bump from concurrent workers
        const bumpResult = await dbQuery(
          `UPDATE orders
           SET premium_bps_current = $1,
               next_bump_at = $2,
               updated_at = NOW(),
               order_version = order_version + 1
           WHERE id = $3
             AND order_version = $4
             AND status = 'pending'
           RETURNING id`,
          [newPremium, nextBumpAt, order.id, order.order_version]
        );
        if (bumpResult.length === 0) {
          logger.warn('[AutoBump] Skipped order (concurrent update)', { orderId: order.id });
          continue;
        }

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
      } catch (err) {
        logger.error('[AutoBump] Failed to bump order', {
          orderId: order.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    writeHeartbeat(orders.length);
  } catch (err) {
    logger.error('[AutoBump] Worker error', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function writeHeartbeat(batchSize: number): void {
  try {
    writeFileSync('/tmp/bm-worker-autobump.json', JSON.stringify({
      lastRun: new Date().toISOString(),
      totalBumps,
      lastBatchSize: batchSize,
    }));
  } catch { /* non-critical */ }
}

export function startAutoBumpWorker(): void {
  if (isRunning) return;
  isRunning = true;
  logger.info('[AutoBump] Starting auto-bump worker', { pollInterval: POLL_INTERVAL_MS });

  const poll = async () => {
    if (!isRunning) return;
    await processAutoBumps();
    pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
  };

  poll();
}

export function stopAutoBumpWorker(): void {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logger.info('[AutoBump] Stopped auto-bump worker');
}
