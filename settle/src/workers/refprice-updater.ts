/**
 * Reference Price Updater Worker
 *
 * Periodically calculates the reference price for corridors based on
 * recent completed trades using a trimmed median approach.
 *
 * Run this as a background process or cron job.
 */

import {
  calculateRefPriceFromTrades,
  updateCorridorRefPrice,
  getCorridorPrice,
  getMempoolOrders,
  getActiveMerchantQuotes,
} from '@/lib/db/repositories/mempool';
import { query } from '@/lib/db';

const WORKER_INTERVAL_MS = 30000; // Update every 30 seconds
const LOOKBACK_MINUTES = 5; // Use last 5 minutes of trades

async function updateCorridorMetrics(corridorId: string) {
  try {
    // Calculate new reference price from recent trades
    const calculatedRefPrice = await calculateRefPriceFromTrades(corridorId, LOOKBACK_MINUTES);

    if (!calculatedRefPrice) {
      console.log(`[refprice] No recent trades for ${corridorId}, skipping update`);
      return;
    }

    // Get current corridor data
    const currentCorridor = await getCorridorPrice(corridorId);

    // Calculate 5-minute volume
    const volumeResult = await query<{ volume_5m: number }>(
      `SELECT COALESCE(SUM(crypto_amount), 0) as volume_5m
       FROM orders
       WHERE corridor_id = $1
         AND status = 'completed'
         AND completed_at > NOW() - INTERVAL '5 minutes'`,
      [corridorId]
    );
    const volume5m = volumeResult[0]?.volume_5m || 0;

    // Calculate average fill time (in seconds)
    const fillTimeResult = await query<{ avg_fill_time_sec: number }>(
      `SELECT COALESCE(
        AVG(EXTRACT(EPOCH FROM (completed_at - created_at))), 0
      )::INTEGER as avg_fill_time_sec
       FROM orders
       WHERE corridor_id = $1
         AND status = 'completed'
         AND completed_at > NOW() - INTERVAL '5 minutes'`,
      [corridorId]
    );
    const avgFillTimeSec = fillTimeResult[0]?.avg_fill_time_sec || 0;

    // Count active merchants
    const activeMerchants = await getActiveMerchantQuotes(corridorId);
    const activeMerchantsCount = activeMerchants.length;

    // Update corridor price
    await updateCorridorRefPrice(
      corridorId,
      calculatedRefPrice,
      volume5m,
      avgFillTimeSec,
      activeMerchantsCount
    );

    const priceChange = currentCorridor
      ? ((calculatedRefPrice - currentCorridor.ref_price) / currentCorridor.ref_price) * 100
      : 0;

    console.log(
      `[refprice] ${corridorId}: ${calculatedRefPrice.toFixed(6)} AED/USDT ` +
      `(${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%) | ` +
      `Volume: ${volume5m.toFixed(2)} USDT | ` +
      `Avg Fill: ${avgFillTimeSec}s | ` +
      `Active Merchants: ${activeMerchantsCount}`
    );
  } catch (error) {
    console.error(`[refprice] Failed to update ${corridorId}:`, error);
  }
}

async function processUpdate() {
  try {
    // Currently only supporting USDT_AED, but this can be extended to multiple corridors
    const corridors = ['USDT_AED'];

    for (const corridorId of corridors) {
      await updateCorridorMetrics(corridorId);
    }
  } catch (error) {
    console.error('[refprice] Worker error:', error);
  }
}

async function start() {
  console.log('[refprice] Reference Price Updater started');
  console.log(`[refprice] Updating every ${WORKER_INTERVAL_MS}ms`);
  console.log(`[refprice] Using ${LOOKBACK_MINUTES}-minute lookback window`);

  // Initial run
  await processUpdate();

  // Schedule periodic runs
  setInterval(processUpdate, WORKER_INTERVAL_MS);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('[refprice] Worker shutting down');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[refprice] Worker shutting down');
  process.exit(0);
});

// Start worker if run directly
if (require.main === module) {
  start().catch((error) => {
    console.error('[refprice] Failed to start worker:', error);
    process.exit(1);
  });
}

export { start, processUpdate };
