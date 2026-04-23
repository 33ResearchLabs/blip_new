import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { query } from '@/lib/db';
import { resolveAuction } from '@/lib/auctions/resolveAuction';
import { logger } from '@/lib/logger';

/**
 * POST /api/auctions/finalize-expired
 *
 * Cron sweeper: finds every `order_auctions` row whose bidding window has
 * passed but status is still `open`, then runs the filter → score → lock
 * pipeline for each. Without this, auctions only resolve when the user
 * happens to be viewing OrderDetailScreen at the exact moment the window
 * closes — if the tab is elsewhere or closed, the auction would sit
 * `open` forever.
 *
 * Mirrors the `POST /api/orders/expire` pattern: admin-authed, GET alias
 * so cron jobs can hit it without a POST body, bounded per-call so a long
 * outage doesn't thunder on restart.
 */

const MAX_AUCTIONS_PER_SWEEP = 50;

export async function POST(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const expired = await query<{ order_id: string; id: string }>(
      `SELECT id, order_id
         FROM order_auctions
        WHERE status = 'open'
          AND window_closes_at <= NOW()
        ORDER BY window_closes_at ASC
        LIMIT $1`,
      [MAX_AUCTIONS_PER_SWEEP],
    );

    if (expired.length === 0) {
      return NextResponse.json({ success: true, data: { swept: 0, results: [] } });
    }

    const results: Array<{ orderId: string; auctionId: string; status: string; detail?: string }> = [];
    for (const row of expired) {
      try {
        const r = await resolveAuction(row.order_id);
        results.push({ orderId: row.order_id, auctionId: row.id, status: r.status });
      } catch (err) {
        logger.error('[AuctionSweep] resolveAuction threw', {
          orderId: row.order_id,
          auctionId: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
        results.push({
          orderId: row.order_id,
          auctionId: row.id,
          status: 'error',
          detail: err instanceof Error ? err.message : 'unknown',
        });
      }
    }

    const locked = results.filter((r) => r.status === 'locked').length;
    const noBids = results.filter((r) => r.status === 'no_bids' || r.status === 'no_valid_bids').length;
    const errors = results.filter((r) => r.status === 'error').length;

    logger.info('[AuctionSweep] Finalized expired auctions', {
      swept: results.length,
      locked,
      noBids,
      errors,
    });

    return NextResponse.json({
      success: true,
      data: { swept: results.length, locked, no_bids: noBids, errors, results },
    });
  } catch (error) {
    logger.error('[AuctionSweep] Failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'Failed to sweep auctions' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
