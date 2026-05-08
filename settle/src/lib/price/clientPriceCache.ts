"use client";

import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

// Client-side cache for /api/prices/current responses.
//
// Why: the merchant Lock-Escrow click handler used to `await` this endpoint
// before opening the modal, freezing the UI for 500ms–2s on every click.
// The DB order created later uses the backend's authoritative rate, so the
// rate read here is purely for the modal's display total — a value that's
// already documented as approximate (see useOrderActions.ts comment).
//
// Strategy:
//  - 30s TTL keeps the displayed rate close to live without per-click waits.
//  - getCachedPrice() is synchronous → caller can open the modal without an
//    await on the hot path.
//  - ensurePriceFresh() fires a background refresh when the cache is stale,
//    deduped via inFlight so concurrent callers share one request.
//  - On fetch failure the previous cache entry (if any) is retained, so
//    the next click still reads a recent value rather than a hard fallback.

const TTL_MS = 30_000;

interface CacheEntry {
  price: number;
  ts: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<number | null>>();

export function getCachedPrice(pair: string): number | null {
  const entry = cache.get(pair);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) return null;
  return entry.price;
}

export async function refreshPrice(pair: string): Promise<number | null> {
  const existing = inFlight.get(pair);
  if (existing) return existing;

  const p = (async () => {
    try {
      const res = await fetchWithAuth(`/api/prices/current?pair=${pair}`);
      const json = await res.json();
      if (json?.success && json.data?.price) {
        const price = Number(json.data.price);
        if (Number.isFinite(price) && price > 0) {
          cache.set(pair, { price, ts: Date.now() });
          return price;
        }
      }
      return null;
    } catch {
      return null;
    } finally {
      inFlight.delete(pair);
    }
  })();

  inFlight.set(pair, p);
  return p;
}

// Fire-and-forget: trigger a background refresh if the cache is stale.
// Safe to call on every click — the inFlight map collapses concurrent calls.
export function ensurePriceFresh(pair: string): void {
  if (getCachedPrice(pair) !== null) return;
  void refreshPrice(pair);
}
