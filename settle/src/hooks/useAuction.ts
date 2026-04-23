/**
 * useAuction — client hook for the hybrid-pricing bidding window.
 *
 * Polls `GET /api/orders/:id/auction` while the auction is `open` and
 * exposes normalized state the user + merchant UI can render:
 *   - auction metadata + status
 *   - live bid list (sorted by rate desc so the "best" bid is first)
 *   - time remaining until window_closes_at
 *   - the winning bid once locked
 *
 * Zero-regression contract: when the order is not in auction mode the
 * hook can be called safely and returns `{ auction: null, bids: [], … }`
 * — the GET endpoint already returns this shape for non-auction orders.
 * Callers can therefore render the hook unconditionally and gate the
 * auction UI on `auction !== null`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

export interface AuctionState {
  id: string;
  order_id: string;
  mode: 'fastest' | 'recommended' | 'best_value';
  base_rate: string | number;
  base_fee_bps: number;
  window_ms: number;
  window_opens_at: string | Date;
  window_closes_at: string | Date;
  status: 'open' | 'scoring' | 'locked' | 'no_bids' | 'cancelled';
  winning_bid_id: string | null;
  bid_count: number;
}

export interface BidView {
  id: string;
  merchant_id: string;
  merchant_name: string | null;
  merchant_rating: number | null;
  rate: number;
  max_amount: number;
  eta_seconds: number;
  status: 'submitted' | 'filtered' | 'won' | 'lost' | 'expired';
  rejection_reason: string | null;
  created_at: string | Date;
}

export interface UseAuctionResult {
  auction: AuctionState | null;
  bids: BidView[];
  /** Best bid by rate (highest), or null if none. Useful for `+X better than base` UI. */
  bestBid: BidView | null;
  /** The winning bid once auction.status === 'locked'. */
  winner: BidView | null;
  /** Milliseconds until window_closes_at; clamped to >= 0. null if auction absent. */
  timeRemainingMs: number | null;
  /** True while the fetch is pending its first response. */
  loading: boolean;
  /** Last error from the polling fetch, if any. Non-fatal — polling continues. */
  error: string | null;
  /** Force an immediate re-fetch (e.g. after a merchant submits a new bid). */
  refresh: () => void;
}

const POLL_INTERVAL_MS = 2000;

export function useAuction(orderId: string | null | undefined): UseAuctionResult {
  const [auction, setAuction] = useState<AuctionState | null>(null);
  const [bids, setBids] = useState<BidView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inFlightRef = useRef(false);

  const fetchOnce = useCallback(async () => {
    if (!orderId || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetchWithAuth(`/api/orders/${orderId}/auction`);
      if (!res.ok) {
        setError(`auction fetch failed: ${res.status}`);
        return;
      }
      const body = (await res.json()) as {
        success?: boolean;
        data?: { auction: AuctionState | null; bids: BidView[] };
      };
      if (body?.success === false) {
        setError('auction fetch not successful');
        return;
      }
      setAuction(body.data?.auction ?? null);
      setBids(body.data?.bids ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [orderId]);

  // Initial fetch + polling loop. We stop polling once status is terminal
  // ('locked', 'no_bids', 'cancelled') — nothing will change after that
  // except via an explicit `refresh()`.
  useEffect(() => {
    if (!orderId) return;
    setLoading(true);
    void fetchOnce();

    const terminal = auction?.status === 'locked'
      || auction?.status === 'no_bids'
      || auction?.status === 'cancelled';
    if (terminal) return;

    const id = setInterval(() => {
      void fetchOnce();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [orderId, fetchOnce, auction?.status]);

  // 1 Hz clock tick for the countdown UI — independent of poll cadence.
  useEffect(() => {
    if (!auction || auction.status !== 'open') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [auction]);

  const bestBid = useMemo<BidView | null>(() => {
    if (bids.length === 0) return null;
    // Highest rate wins for both BUY and SELL in this UI — the scoring
    // server-side incorporates ETA / rating, but for the banner "X USDT
    // above base" we show the headline rate. Filter to submitted.
    const active = bids.filter((b) => b.status === 'submitted' || b.status === 'won');
    if (active.length === 0) return null;
    return [...active].sort((a, b) => b.rate - a.rate)[0];
  }, [bids]);

  const winner = useMemo<BidView | null>(() => {
    if (!auction || auction.status !== 'locked' || !auction.winning_bid_id) return null;
    return bids.find((b) => b.id === auction.winning_bid_id) ?? null;
  }, [auction, bids]);

  const timeRemainingMs = useMemo<number | null>(() => {
    if (!auction) return null;
    const closes = typeof auction.window_closes_at === 'string'
      ? Date.parse(auction.window_closes_at)
      : new Date(auction.window_closes_at).getTime();
    return Math.max(0, closes - now);
  }, [auction, now]);

  return {
    auction,
    bids,
    bestBid,
    winner,
    timeRemainingMs,
    loading,
    error,
    refresh: () => void fetchOnce(),
  };
}
