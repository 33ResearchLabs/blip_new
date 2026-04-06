/**
 * Price Tick Collector Worker
 *
 * Runs every 25 seconds. For each supported pair:
 *   1. Fetch price from CoinGecko (primary)
 *   2. If fails → fallback to Binance
 *   3. Store tick in price_ticks table
 *
 * Also runs a daily cleanup to remove ticks older than 24 hours.
 *
 * Usage:  tsx src/workers/price-tick-collector.ts
 */

import {
  SUPPORTED_PAIRS,
  fetchCoinGeckoPrice,
  fetchBinancePrice,
  fetchKuCoinPrice,
  storeTick,
  cleanupOldTicks,
} from '@/lib/price/usdtInrPrice';

const TICK_INTERVAL_MS = 25_000;        // 25 seconds
const CLEANUP_INTERVAL_MS = 3_600_000;  // 1 hour
const HOURS_TO_KEEP = 24;

// ---------------------------------------------------------------------------
// Collect one round of ticks for all pairs
// ---------------------------------------------------------------------------

async function collectTicks() {
  for (const pair of SUPPORTED_PAIRS) {
    try {
      let price: number | null = null;
      let source = 'coingecko';

      // Primary: CoinGecko
      price = await fetchCoinGeckoPrice(pair.fiat);

      // Fallback 1: Binance
      if (price === null && pair.binanceSymbol) {
        console.warn(`[price-tick] ${pair.id}: CoinGecko failed, trying Binance`);
        price = await fetchBinancePrice(pair.binanceSymbol);
        source = 'binance';
      }

      // Fallback 2: ExchangeRate API (USD→fiat, USDT ≈ 1 USD)
      if (price === null) {
        console.warn(`[price-tick] ${pair.id}: Binance failed, trying ExchangeRate API`);
        price = await fetchKuCoinPrice(pair.fiat);
        source = 'exchangerate';
      }

      if (price === null) {
        console.error(`[price-tick] ${pair.id}: ALL sources failed — no tick stored`);
        continue;
      }

      await storeTick(pair.id, price, source);
      console.log(`[price-tick] ${pair.id}: ${price} (${source})`);
    } catch (err) {
      console.error(`[price-tick] ${pair.id}: error:`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Cleanup old ticks
// ---------------------------------------------------------------------------

async function runCleanup() {
  try {
    const deleted = await cleanupOldTicks(HOURS_TO_KEEP);
    if (deleted > 0) {
      console.log(`[price-tick] Cleaned up ${deleted} ticks older than ${HOURS_TO_KEEP}h`);
    }
  } catch (err) {
    console.error('[price-tick] Cleanup error:', err);
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function start() {
  console.log('[price-tick] Price Tick Collector started');
  console.log(`[price-tick] Collecting every ${TICK_INTERVAL_MS / 1000}s for ${SUPPORTED_PAIRS.length} pairs`);
  console.log(`[price-tick] Pairs: ${SUPPORTED_PAIRS.map((p) => p.id).join(', ')}`);

  // Initial run
  await collectTicks();

  // Schedule periodic tick collection
  setInterval(collectTicks, TICK_INTERVAL_MS);

  // Schedule hourly cleanup
  setInterval(runCleanup, CLEANUP_INTERVAL_MS);
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[price-tick] Shutting down');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[price-tick] Shutting down');
  process.exit(0);
});

if (require.main === module) {
  start().catch((err) => {
    console.error('[price-tick] Failed to start:', err);
    process.exit(1);
  });
}

export { start, collectTicks, runCleanup };
