/**
 * Auto-Bump Worker
 *
 * Periodically checks for orders that need automatic priority bumping
 * and bumps them according to their bump_interval_sec configuration.
 *
 * Run this as a background process or cron job.
 */

import { getOrdersReadyForAutoBump, bumpOrderPriority } from '@/lib/db/repositories/mempool';
import { transaction } from '@/lib/db';

const WORKER_INTERVAL_MS = 10000; // Check every 10 seconds
const BUMP_BATCH_SIZE = 20; // Max orders per cycle

async function processAutoBumps() {
  try {
    // Distribution-safe: claim rows with FOR UPDATE SKIP LOCKED inside a transaction
    // so multiple worker instances never process the same orders
    const bumpedOrders = await transaction(async (client) => {
      const lockResult = await client.query(
        `SELECT id FROM orders
         WHERE auto_bump_enabled = TRUE
           AND status = 'pending'
           AND next_bump_at IS NOT NULL
           AND next_bump_at <= NOW()
           AND premium_bps_current < premium_bps_cap
         FOR UPDATE SKIP LOCKED
         LIMIT $1`,
        [BUMP_BATCH_SIZE]
      );

      if (lockResult.rows.length === 0) {
        return [];
      }

      const results: { orderId: string; new_premium_bps: number; max_reached: boolean }[] = [];

      for (const row of lockResult.rows) {
        try {
          const result = await bumpOrderPriority(row.id, true);
          results.push({ orderId: row.id, ...result });
        } catch (error) {
          console.error(`[auto-bump] Failed to bump order ${row.id}:`, error);
        }
      }

      return results;
    });

    if (bumpedOrders.length === 0) {
      console.log('[auto-bump] No orders ready for auto-bump');
      return;
    }

    for (const result of bumpedOrders) {
      console.log(
        `[auto-bump] Order ${result.orderId} bumped to ${result.new_premium_bps} bps` +
        (result.max_reached ? ' (max reached)' : '')
      );
    }
  } catch (error) {
    console.error('[auto-bump] Worker error:', error);
  }
}

async function start() {
  console.log('[auto-bump] Worker started');
  console.log(`[auto-bump] Checking every ${WORKER_INTERVAL_MS}ms`);

  // Initial run
  await processAutoBumps();

  // Schedule periodic runs
  setInterval(processAutoBumps, WORKER_INTERVAL_MS);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('[auto-bump] Worker shutting down');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[auto-bump] Worker shutting down');
  process.exit(0);
});

// Start worker if run directly
if (require.main === module) {
  start().catch((error) => {
    console.error('[auto-bump] Failed to start worker:', error);
    process.exit(1);
  });
}

export { start, processAutoBumps };
