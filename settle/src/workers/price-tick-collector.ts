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
  fetchCoinGeckoPricesBatch,
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
//
// Strategy:
//   1. Single batched CoinGecko call for ALL fiats (one HTTP request).
//   2. Per-pair fallback to Binance for any pair CoinGecko didn't return
//      (Binance is auto-skipped after the first 451 — see usdtInrPrice.ts).
//   3. Final fallback to ExchangeRate API (USD→fiat, USDT ≈ 1 USD).
//   4. Store the tick. One concise summary log per cycle, not per pair.
// ---------------------------------------------------------------------------

async function collectTicks() {
  // Step 1: one batched CoinGecko call covering every supported fiat
  const fiats = Array.from(new Set(SUPPORTED_PAIRS.map((p) => p.fiat.toLowerCase())));
  const cgPrices = await fetchCoinGeckoPricesBatch(fiats);

  const results: Array<{ pair: string; price: number; source: string } | { pair: string; failed: true }> = [];

  for (const pair of SUPPORTED_PAIRS) {
    try {
      let price: number | null = cgPrices[pair.fiat.toLowerCase()] ?? null;
      let source = 'coingecko';

      // Fallback 1: Binance (no-op if region-blocked)
      if (price === null && pair.binanceSymbol) {
        price = await fetchBinancePrice(pair.binanceSymbol);
        if (price !== null) source = 'binance';
      }

      // Fallback 2: ExchangeRate API
      if (price === null) {
        price = await fetchKuCoinPrice(pair.fiat);
        if (price !== null) source = 'exchangerate';
      }

      if (price === null) {
        console.error(`[price-tick] ${pair.id}: ALL sources failed — no tick stored`);
        results.push({ pair: pair.id, failed: true });
        continue;
      }

      await storeTick(pair.id, price, source);
      results.push({ pair: pair.id, price, source });
    } catch (err) {
      console.error(
        `[price-tick] ${pair.id}: tick storage error:`,
        err instanceof Error ? err.message : err,
      );
      results.push({ pair: pair.id, failed: true });
    }
  }

  // One concise summary log per cycle instead of per-pair noise
  const summary = results
    .map((r) => ('failed' in r ? `${r.pair}=FAIL` : `${r.pair}=${r.price}(${r.source})`))
    .join(' ');
  console.log(`[price-tick] ${summary}`);
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
