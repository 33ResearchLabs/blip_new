/**
 * Price Feed Worker (Core API)
 *
 * Computes corridor reference price from completed trades using VWAP with time decay.
 * Updates corridor_prices table and broadcasts to all merchants via WebSocket.
 *
 * Algorithm copied from settle/src/app/api/corridor/dynamic-rate/route.ts
 */
import { query as dbQuery, logger } from 'settlement-core';
import { broadcastPriceEvent } from '../ws/broadcast';
import { writeFileSync } from 'fs';
const POLL_INTERVAL_MS = parseInt(process.env.PRICE_FEED_POLL_MS || '30000', 10);
const FALLBACK_RATE = 3.67;
const MIN_ORDERS_REQUIRED = 5;
const LOOKBACK_HOURS = 6;
const OUTLIER_THRESHOLD = 0.15; // 15% deviation from median
let isRunning = false;
let pollTimer = null;
// --- Pure VWAP functions (from dynamic-rate/route.ts) ---
function getTimeWeight(ageHours) {
    if (ageHours <= 1)
        return 1.0;
    if (ageHours <= 3)
        return 0.7;
    if (ageHours <= 6)
        return 0.3;
    return 0;
}
function getMedian(rates) {
    const sorted = [...rates].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}
function calculateVWAP(orders) {
    if (orders.length < MIN_ORDERS_REQUIRED) {
        return { rate: FALLBACK_RATE, isFallback: true };
    }
    const rates = orders.map(o => o.rate);
    const medianRate = getMedian(rates);
    // Filter outliers (>15% from median)
    const validOrders = orders.filter(order => {
        const deviation = Math.abs(order.rate - medianRate) / medianRate;
        return deviation <= OUTLIER_THRESHOLD;
    });
    if (validOrders.length < MIN_ORDERS_REQUIRED) {
        return { rate: FALLBACK_RATE, isFallback: true };
    }
    let weightedSum = 0;
    let totalWeight = 0;
    for (const order of validOrders) {
        const timeWeight = getTimeWeight(order.age_hours);
        const weight = order.amount_aed * timeWeight;
        weightedSum += order.rate * weight;
        totalWeight += weight;
    }
    const vwap = totalWeight > 0 ? weightedSum / totalWeight : FALLBACK_RATE;
    return { rate: Math.round(vwap * 10000) / 10000, isFallback: false };
}
// --- Worker logic ---
async function processCorridors() {
    const corridors = ['USDT_AED'];
    for (const corridorId of corridors) {
        try {
            // Fetch completed orders from last 6 hours
            const orders = await dbQuery(`SELECT
          fiat_amount::numeric as amount_aed,
          rate::numeric as rate,
          EXTRACT(EPOCH FROM (NOW() - completed_at)) / 3600 as age_hours
         FROM orders
         WHERE status = 'completed'
           AND completed_at > NOW() - INTERVAL '${LOOKBACK_HOURS} hours'
           AND fiat_amount > 0
           AND rate > 0
         ORDER BY completed_at DESC`, []);
            const { rate: refPrice, isFallback } = calculateVWAP(orders);
            // 5-minute volume
            const volResult = await dbQuery(`SELECT COALESCE(SUM(crypto_amount), 0)::text as v
         FROM orders
         WHERE status = 'completed'
           AND completed_at > NOW() - INTERVAL '5 minutes'`, []);
            const volume5m = parseFloat(volResult[0]?.v || '0');
            // Confidence level
            const confidence = isFallback ? 'low' : orders.length >= 20 ? 'high' : 'medium';
            // Update corridor_prices
            await dbQuery(`UPDATE corridor_prices
         SET ref_price = $2,
             volume_5m = $3,
             confidence = $4,
             updated_at = NOW()
         WHERE corridor_id = $1`, [corridorId, refPrice, volume5m, confidence]);
            // Broadcast to all connected merchants
            broadcastPriceEvent({
                corridor_id: corridorId,
                ref_price: refPrice,
                volume_5m: volume5m,
                confidence,
                updated_at: new Date().toISOString(),
            });
            writeHeartbeat(corridorId, refPrice, confidence, orders.length);
            logger.info('[PriceFeed] Updated', {
                corridorId,
                refPrice,
                volume5m,
                confidence,
                ordersAnalyzed: orders.length,
                isFallback,
            });
        }
        catch (err) {
            logger.error('[PriceFeed] Error processing corridor', {
                corridorId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
}
function writeHeartbeat(corridorId, price, confidence, ordersAnalyzed) {
    try {
        writeFileSync('/tmp/bm-worker-pricefeed.json', JSON.stringify({
            lastRun: new Date().toISOString(),
            corridorId,
            price,
            confidence,
            ordersAnalyzed,
        }));
    }
    catch { /* non-critical */ }
}
export function startPriceFeedWorker() {
    if (isRunning)
        return;
    isRunning = true;
    logger.info('[PriceFeed] Starting price feed worker', { pollInterval: POLL_INTERVAL_MS });
    const poll = async () => {
        if (!isRunning)
            return;
        await processCorridors();
        pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    };
    poll();
}
export function stopPriceFeedWorker() {
    isRunning = false;
    if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
    logger.info('[PriceFeed] Stopped price feed worker');
}
