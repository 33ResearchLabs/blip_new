/**
 * Auto-Bump Worker
 *
 * Periodically checks for orders that need automatic priority bumping
 * and bumps them according to their bump_interval_sec configuration.
 *
 * Run this as a background process or cron job.
 */

import { getOrdersReadyForAutoBump, bumpOrderPriority } from '@/lib/db/repositories/mempool';

const WORKER_INTERVAL_MS = 10000; // Check every 10 seconds

async function processAutoBumps() {
  try {
    const orderIds = await getOrdersReadyForAutoBump();

    if (orderIds.length === 0) {
      console.log('[auto-bump] No orders ready for auto-bump');
      return;
    }

    console.log(`[auto-bump] Processing ${orderIds.length} orders for auto-bump`);

    for (const orderId of orderIds) {
      try {
        const result = await bumpOrderPriority(orderId, true);
        console.log(
          `[auto-bump] Order ${orderId} bumped to ${result.new_premium_bps} bps` +
          (result.max_reached ? ' (max reached)' : '')
        );
      } catch (error) {
        console.error(`[auto-bump] Failed to bump order ${orderId}:`, error);
      }
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
