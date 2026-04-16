"use client";

import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

export type CorridorPrices = {
  USDT_AED: number | null;
  USDT_INR: number | null;
};

/**
 * Live per-corridor reference prices for premium badges and deviation math.
 *
 * Source of truth: /api/corridor/dynamic-rate which honors the admin's manual
 * price when set, else returns the corridor_prices VWAP (updated every 30s
 * by core-api's price feed worker). Identical pattern to StatusCard — lifted
 * to a shared hook so the order panels (Pending + In-Progress) don't each
 * start their own polling loop.
 *
 * Module-level singleton: one fetch cycle shared across every hook consumer.
 * When the last consumer unmounts, polling stops.
 */

let cached: CorridorPrices = { USDT_AED: null, USDT_INR: null };
const subscribers = new Set<(p: CorridorPrices) => void>();
let pollInterval: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

async function fetchPrices(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const [aedRes, inrRes] = await Promise.all([
      fetchWithAuth("/api/corridor/dynamic-rate?pair=usdt_aed"),
      fetchWithAuth("/api/corridor/dynamic-rate?pair=usdt_inr"),
    ]);
    const next: CorridorPrices = { ...cached };
    if (aedRes.ok) {
      const d = await aedRes.json();
      if (d?.success && typeof d.data?.ref_price === "number" && d.data.ref_price > 0) {
        next.USDT_AED = d.data.ref_price;
      }
    }
    if (inrRes.ok) {
      const d = await inrRes.json();
      if (d?.success && typeof d.data?.ref_price === "number" && d.data.ref_price > 0) {
        next.USDT_INR = d.data.ref_price;
      }
    }
    cached = next;
    subscribers.forEach((fn) => fn(next));
  } catch {
    // Silent: a failed fetch just keeps the last good cache. Panels fall
    // back to the order's stored ref_price_at_create or skip the badge.
  } finally {
    inFlight = false;
  }
}

export function useCorridorPrices(): CorridorPrices {
  const [prices, setPrices] = useState<CorridorPrices>(cached);

  useEffect(() => {
    subscribers.add(setPrices);
    // Seed from module cache; kick off fetch if we don't have data yet.
    setPrices(cached);
    if (cached.USDT_AED === null && cached.USDT_INR === null) {
      fetchPrices();
    }
    if (!pollInterval) {
      pollInterval = setInterval(fetchPrices, 30_000);
    }
    return () => {
      subscribers.delete(setPrices);
      if (subscribers.size === 0 && pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };
  }, []);

  return prices;
}

/** Resolve the live ref price for a given corridor / fiat pair. */
export function resolveCorridorRef(
  prices: CorridorPrices,
  corridorId: string | null | undefined,
  fiatCurrency?: string | null,
): number | null {
  if (corridorId === "USDT_AED") return prices.USDT_AED;
  if (corridorId === "USDT_INR") return prices.USDT_INR;
  // Back-compat: some older orders have fiat_currency but no corridor_id.
  if (fiatCurrency === "AED") return prices.USDT_AED;
  if (fiatCurrency === "INR") return prices.USDT_INR;
  return null;
}
