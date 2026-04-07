/**
 * USDT Price Engine — Tick-based, multi-pair
 *
 * - Worker stores a price_tick every 25s (CoinGecko → Binance fallback)
 * - API reads ticks from DB to compute avg price + chart over a timeframe
 * - In-memory cache (keyed pair+timeframe, TTL 20s) prevents repeated DB hits
 */

import { query, queryOne } from '@/lib/db';

// ---------------------------------------------------------------------------
// Pair registry — add new pairs here
// ---------------------------------------------------------------------------

export interface PairConfig {
  id: string;
  label: string;
  fiat: string;                   // CoinGecko vs_currency (lowercase)
  binanceSymbol: string | null;   // Binance ticker, null if unsupported
}

export const SUPPORTED_PAIRS: PairConfig[] = [
  { id: 'usdt_inr', label: 'USDT / INR', fiat: 'inr', binanceSymbol: 'USDTINR' },
  { id: 'usdt_aed', label: 'USDT / AED', fiat: 'aed', binanceSymbol: null },
];

export function getPairConfig(pairId: string): PairConfig | undefined {
  return SUPPORTED_PAIRS.find((p) => p.id === pairId);
}

// ---------------------------------------------------------------------------
// Timeframes
// ---------------------------------------------------------------------------

export const TIMEFRAMES = {
  '1m':  { label: '1 min',  seconds: 60 },
  '5m':  { label: '5 min',  seconds: 300 },
  '15m': { label: '15 min', seconds: 900 },
  '1h':  { label: '1 hour', seconds: 3600 },
} as const;

export type Timeframe = keyof typeof TIMEFRAMES;

export function isValidTimeframe(tf: string): tf is Timeframe {
  return tf in TIMEFRAMES;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PriceSource = 'coingecko' | 'binance' | 'kucoin' | 'exchangerate' | 'cache' | 'db' | 'fallback';

export type PriceMode = 'LIVE' | 'MANUAL';

export interface PriceConfigRow {
  key: string;
  price_mode: PriceMode;
  admin_price: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface FinalPrice {
  pair: string;
  label: string;
  price: number;
  mode: PriceMode;
  livePrice: number;
  adminPrice: number | null;
}

export interface PriceResponse {
  pair: string;
  label: string;
  livePrice: number;
  avgPrice: number;
  timeframe: Timeframe;
  source: PriceSource;
  history: { time: string; value: number }[];
  tickCount: number;
}

// ---------------------------------------------------------------------------
// In-memory cache  (key = `${pair}:${timeframe}`)
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: PriceResponse;
  expiresAt: number;
}

const CACHE_TTL_MS = 20_000; // 20 seconds
const cacheMap = new Map<string, CacheEntry>();

function cacheKey(pair: string, tf: Timeframe) { return `${pair}:${tf}`; }

function getCached(pair: string, tf: Timeframe): PriceResponse | null {
  const e = cacheMap.get(cacheKey(pair, tf));
  if (e && Date.now() < e.expiresAt) return e.data;
  return null;
}

function setCache(pair: string, tf: Timeframe, data: PriceResponse): void {
  cacheMap.set(cacheKey(pair, tf), { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ---------------------------------------------------------------------------
// External API fetchers  (used by the worker, exported for reuse)
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT = 8_000;

/**
 * Batched CoinGecko fetch — pulls all requested fiats in ONE HTTP call.
 * Halves CoinGecko traffic vs. fetching pairs one-by-one, which matters on
 * shared cloud IPs (Railway, Vercel) where the free-tier rate limit is
 * pooled across tenants and trips 429 easily.
 *
 * Returns a map { fiat → price }; missing fiats are absent from the map.
 */
export async function fetchCoinGeckoPricesBatch(
  fiats: string[],
): Promise<Record<string, number>> {
  if (fiats.length === 0) return {};
  try {
    const vs = fiats.map((f) => f.toLowerCase()).join(',');
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=${vs}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT) },
    );
    if (!res.ok) {
      // Quiet warning — caller handles fallback. No stack trace for expected upstream failures.
      console.warn(`[PriceTick] CoinGecko ${res.status} (rate-limited or unavailable)`);
      return {};
    }
    const json = await res.json();
    const out: Record<string, number> = {};
    for (const f of fiats) {
      const v = json?.tether?.[f.toLowerCase()];
      if (typeof v === 'number' && v > 0) out[f.toLowerCase()] = v;
    }
    return out;
  } catch (err) {
    console.warn(
      `[PriceTick] CoinGecko fetch error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {};
  }
}

// Single-fiat helper kept for callers that still want the old signature.
// Internally uses the batched call so caching/rate behaviour stays consistent.
export async function fetchCoinGeckoPrice(fiat: string): Promise<number | null> {
  const map = await fetchCoinGeckoPricesBatch([fiat]);
  return map[fiat.toLowerCase()] ?? null;
}

// Binance is geo-blocked on most cloud providers (Railway, Fly, AWS us-east).
// Once we see 451 once, we stop trying for the lifetime of this process —
// the policy isn't going to flip mid-session and every retry just adds latency
// and log noise to the tick cycle.
let binancePermanentlyBlocked = false;

export async function fetchBinancePrice(symbol: string): Promise<number | null> {
  if (binancePermanentlyBlocked) return null;
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT) },
    );
    if (!res.ok) {
      if (res.status === 451 || res.status === 403) {
        binancePermanentlyBlocked = true;
        console.warn(
          `[PriceTick] Binance ${res.status} — region-blocked, disabling for this process`,
        );
      } else {
        console.warn(`[PriceTick] Binance ${symbol} status ${res.status}`);
      }
      return null;
    }
    const json = await res.json();
    const price = parseFloat(json?.price);
    if (!price || price <= 0) return null;
    return price;
  } catch (err) {
    console.warn(
      `[PriceTick] Binance ${symbol} fetch error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

// KuCoin — no geo-blocking, no API key required
export async function fetchKuCoinPrice(fiat: string): Promise<number | null> {
  // KuCoin only has USDT-INR via USDT price against USD then convert
  // For INR: fetch USDT/USDT (=1) is useless, so we use their USDT price index
  // For AED: similarly via USD conversion
  try {
    // KuCoin doesn't have direct fiat pairs, so use exchangerate.host for fiat conversion
    // This gives us USD→fiat rate, and USDT ≈ 1 USD
    const res = await fetch(
      `https://open.er-api.com/v6/latest/USD`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT) },
    );
    if (!res.ok) {
      console.warn(`[PriceTick] ExchangeRate ${fiat} status ${res.status}`);
      return null;
    }
    const json = await res.json();
    const rate = json?.rates?.[fiat.toUpperCase()];
    if (typeof rate !== 'number' || rate <= 0) return null;
    return parseFloat(rate.toFixed(4));
  } catch (err) {
    console.warn(
      `[PriceTick] ExchangeRate ${fiat} fetch error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

// Last-resort hardcoded fallback prices (updated periodically, better than crashing)
const HARDCODED_FALLBACKS: Record<string, number> = {
  inr: 85.50,
  aed: 3.67,
};

// ---------------------------------------------------------------------------
// DB: store tick (used by worker)
// ---------------------------------------------------------------------------

export async function storeTick(pair: string, price: number, source: string): Promise<void> {
  await query(
    `INSERT INTO price_ticks (pair, price, source) VALUES ($1, $2, $3)`,
    [pair, price, source],
  );
}

// ---------------------------------------------------------------------------
// DB: cleanup old ticks (called by worker periodically)
// ---------------------------------------------------------------------------

export async function cleanupOldTicks(hoursToKeep: number = 24): Promise<number> {
  const res = await query<{ count: string }>(
    `WITH deleted AS (
       DELETE FROM price_ticks WHERE created_at < NOW() - make_interval(hours => $1) RETURNING 1
     ) SELECT COUNT(*)::text as count FROM deleted`,
    [hoursToKeep],
  );
  return parseInt(res[0]?.count || '0');
}

// ---------------------------------------------------------------------------
// DB: read ticks for a timeframe
// ---------------------------------------------------------------------------

interface TickRow {
  price: string;
  source: string;
  created_at: string;
}

async function getTicksForTimeframe(pair: string, tf: Timeframe): Promise<TickRow[]> {
  const secs = TIMEFRAMES[tf].seconds;
  return query<TickRow>(
    `SELECT price, source, created_at
     FROM price_ticks
     WHERE pair = $1 AND created_at >= NOW() - make_interval(secs => $2)
     ORDER BY created_at ASC`,
    [pair, secs],
  );
}

async function getLatestTick(pair: string): Promise<{ price: number; source: string } | null> {
  const row = await queryOne<{ price: string; source: string }>(
    `SELECT price, source FROM price_ticks WHERE pair = $1 ORDER BY created_at DESC LIMIT 1`,
    [pair],
  );
  if (!row) return null;
  return { price: parseFloat(row.price), source: row.source };
}

// ---------------------------------------------------------------------------
// Main query: price data for a pair + timeframe
// ---------------------------------------------------------------------------

export async function getPriceData(pairId: string, tf: Timeframe): Promise<PriceResponse> {
  const pair = getPairConfig(pairId);
  if (!pair) throw new Error(`Unsupported pair: ${pairId}`);
  if (!isValidTimeframe(tf)) throw new Error(`Invalid timeframe: ${tf}`);

  // 1. Cache check
  const cached = getCached(pairId, tf);
  if (cached) return { ...cached, source: 'cache' };

  // 2. Get ticks from DB for the selected timeframe
  const ticks = await getTicksForTimeframe(pairId, tf);

  // 3. Live price = latest tick
  const latest = ticks.length > 0
    ? { price: parseFloat(ticks[ticks.length - 1].price), source: ticks[ticks.length - 1].source }
    : await getLatestTick(pairId);

  // 3b. If no ticks at all → live-fetch from external APIs (waterfall)
  if (!latest) {
    console.warn(`[PriceEngine:${pairId}] No ticks in DB — fetching live`);
    let fallbackPrice: number | null = null;
    let fallbackSource: PriceSource = 'coingecko';

    // Source 1: CoinGecko
    fallbackPrice = await fetchCoinGeckoPrice(pair.fiat);

    // Source 2: Binance
    if (fallbackPrice === null && pair.binanceSymbol) {
      fallbackPrice = await fetchBinancePrice(pair.binanceSymbol);
      fallbackSource = 'binance';
    }

    // Source 3: ExchangeRate API (USD→fiat conversion, USDT ≈ 1 USD)
    if (fallbackPrice === null) {
      fallbackPrice = await fetchKuCoinPrice(pair.fiat);
      fallbackSource = 'exchangerate';
    }

    // Source 4: Hardcoded last-resort (better than crashing)
    if (fallbackPrice === null) {
      const hc = HARDCODED_FALLBACKS[pair.fiat];
      if (hc) {
        console.warn(`[PriceEngine:${pairId}] ALL APIs failed — using hardcoded fallback ${hc}`);
        fallbackPrice = hc;
        fallbackSource = 'fallback';
      }
    }

    if (fallbackPrice === null) {
      throw new Error(`No price data for ${pairId} and all sources failed`);
    }

    // Store the tick so next request has data
    storeTick(pairId, fallbackPrice, fallbackSource).catch(() => {});

    const response: PriceResponse = {
      pair: pairId,
      label: pair.label,
      livePrice: fallbackPrice,
      avgPrice: fallbackPrice,
      timeframe: tf,
      source: fallbackSource,
      history: [{ time: new Date().toISOString(), value: fallbackPrice }],
      tickCount: 0,
    };
    setCache(pairId, tf, response);
    return response;
  }

  // 4. Avg price from ticks in timeframe
  const sum = ticks.reduce((s, t) => s + parseFloat(t.price), 0);
  const avgPrice = ticks.length > 0 ? sum / ticks.length : latest.price;

  // 5. Chart data
  const history = ticks.map((t) => ({
    time: new Date(t.created_at).toISOString(),
    value: parseFloat(parseFloat(t.price).toFixed(4)),
  }));

  // 6. Build & cache
  const response: PriceResponse = {
    pair: pairId,
    label: pair.label,
    livePrice: latest.price,
    avgPrice: parseFloat(avgPrice.toFixed(4)),
    timeframe: tf,
    source: latest.source as PriceSource,
    history,
    tickCount: ticks.length,
  };

  setCache(pairId, tf, response);
  return response;
}

// ---------------------------------------------------------------------------
// Price Config: LIVE / MANUAL mode
// ---------------------------------------------------------------------------

export async function getPriceConfig(pairId: string): Promise<PriceConfigRow | null> {
  const row = await queryOne<PriceConfigRow>(
    `SELECT key, price_mode, admin_price, updated_at, updated_by FROM price_config WHERE key = $1`,
    [pairId],
  );
  return row || null;
}

export async function setPriceConfig(
  pairId: string,
  mode: PriceMode,
  adminPrice: number | null,
  updatedBy: string,
): Promise<void> {
  await query(
    `INSERT INTO price_config (key, price_mode, admin_price, updated_at, updated_by)
     VALUES ($1, $2, $3, NOW(), $4)
     ON CONFLICT (key) DO UPDATE SET
       price_mode = $2,
       admin_price = $3,
       updated_at = NOW(),
       updated_by = $4`,
    [pairId, mode, adminPrice, updatedBy],
  );
}

// ---------------------------------------------------------------------------
// getFinalPrice — single source of truth for all consumers
// ---------------------------------------------------------------------------

export async function getFinalPrice(pairId: string): Promise<FinalPrice> {
  const pair = getPairConfig(pairId);
  if (!pair) throw new Error(`Unsupported pair: ${pairId}`);

  // 1. Get config
  const config = await getPriceConfig(pairId);
  const mode: PriceMode = (config?.price_mode as PriceMode) || 'LIVE';
  const adminPrice = config?.admin_price ? parseFloat(config.admin_price) : null;

  // 2. Get live price (latest tick)
  const latest = await queryOne<{ price: string }>(
    `SELECT price FROM price_ticks WHERE pair = $1 ORDER BY created_at DESC LIMIT 1`,
    [pairId],
  );
  const livePrice = latest ? parseFloat(latest.price) : 0;

  // 3. Final price based on mode
  const price = mode === 'MANUAL' && adminPrice !== null && adminPrice > 0
    ? adminPrice
    : livePrice;

  return {
    pair: pairId,
    label: pair.label,
    price,
    mode,
    livePrice,
    adminPrice,
  };
}
