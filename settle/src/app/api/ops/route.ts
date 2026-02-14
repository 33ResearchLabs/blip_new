/**
 * Ops API Route (localhost-only)
 *
 * Provides combined ops data for the /ops debug page:
 * - Outbox pending list (oldest first)
 * - Stuck orders by state with age buckets
 * - Worker heartbeat status
 * - Order search by ID with event timeline
 *
 * Returns 404 in production to hide endpoint existence.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { readFileSync } from 'fs';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Production guard
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const tab = request.nextUrl.searchParams.get('tab') || 'outbox';
  const orderId = request.nextUrl.searchParams.get('order_id');

  try {
    switch (tab) {
      case 'outbox':
        return NextResponse.json(await getOutboxData());
      case 'stuck':
        return NextResponse.json(await getStuckOrders());
      case 'workers':
        return NextResponse.json(getWorkerHeartbeats());
      case 'search':
        if (!orderId) {
          return NextResponse.json({ error: 'order_id required' }, { status: 400 });
        }
        return NextResponse.json(await searchOrder(orderId));
      default:
        return NextResponse.json({ error: 'Invalid tab' }, { status: 400 });
    }
  } catch (error) {
    console.error('[Ops API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 }
    );
  }
}

// ── Outbox ──

async function getOutboxData() {
  const rows = await query(
    `SELECT id, order_id, event_type, status, attempts, max_attempts,
            created_at, last_attempt_at, sent_at, last_error,
            EXTRACT(EPOCH FROM (NOW() - created_at))::int as age_sec
     FROM notification_outbox
     WHERE status = 'pending'
     ORDER BY created_at ASC
     LIMIT 100`
  );

  const counts = await query<{ status: string; count: string }>(
    `SELECT status, count(*)::text as count FROM notification_outbox GROUP BY status ORDER BY status`
  );

  return {
    tab: 'outbox',
    rows,
    counts: Object.fromEntries(counts.map((c) => [c.status, parseInt(c.count, 10)])),
  };
}

// ── Stuck Orders ──

async function getStuckOrders() {
  // Orders in non-terminal states with age buckets
  const rows = await query<{
    status: string;
    bucket: string;
    count: string;
    oldest_age_min: string;
    newest_age_min: string;
  }>(
    `SELECT
       status,
       CASE
         WHEN EXTRACT(EPOCH FROM (NOW() - created_at)) < 900 THEN '0-15m'
         WHEN EXTRACT(EPOCH FROM (NOW() - created_at)) < 3600 THEN '15m-1h'
         WHEN EXTRACT(EPOCH FROM (NOW() - created_at)) < 86400 THEN '1h-24h'
         ELSE '24h+'
       END as bucket,
       count(*)::text as count,
       (EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) / 60)::int::text as oldest_age_min,
       (EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) / 60)::int::text as newest_age_min
     FROM orders
     WHERE status NOT IN ('completed', 'cancelled', 'expired')
     GROUP BY status, bucket
     ORDER BY status, bucket`
  );

  // Totals per status
  const totals = await query<{ status: string; count: string }>(
    `SELECT status, count(*)::text as count
     FROM orders
     WHERE status NOT IN ('completed', 'cancelled', 'expired')
     GROUP BY status
     ORDER BY status`
  );

  // Orders past expiry but not terminal
  const expiredNotTerminal = await query<{ id: string; order_number: string; status: string; created_at: string; expires_at: string }>(
    `SELECT id, order_number, status, created_at::text, expires_at::text
     FROM orders
     WHERE status NOT IN ('completed', 'cancelled', 'expired')
       AND expires_at IS NOT NULL
       AND expires_at < NOW()
     ORDER BY expires_at ASC
     LIMIT 20`
  );

  return {
    tab: 'stuck',
    buckets: rows,
    totals: Object.fromEntries(totals.map((t) => [t.status, parseInt(t.count, 10)])),
    expiredNotTerminal,
  };
}

// ── Worker Heartbeats ──

function getWorkerHeartbeats() {
  const readHeartbeat = (name: string) => {
    try {
      return JSON.parse(readFileSync(`/tmp/bm-worker-${name}.json`, 'utf-8'));
    } catch {
      return { status: 'not running' };
    }
  };

  return {
    tab: 'workers',
    outbox: readHeartbeat('outbox'),
    expiry: readHeartbeat('expiry'),
  };
}

// ── Order Search ──

async function searchOrder(orderId: string) {
  // Try exact UUID match first, then partial order_number match
  const orders = await query<{
    id: string;
    order_number: string;
    status: string;
    type: string;
    crypto_amount: string;
    fiat_amount: string;
    merchant_id: string;
    user_id: string;
    buyer_merchant_id: string | null;
    created_at: string;
    accepted_at: string | null;
    escrowed_at: string | null;
    payment_sent_at: string | null;
    payment_confirmed_at: string | null;
    completed_at: string | null;
    cancelled_at: string | null;
    expires_at: string | null;
    escrow_tx_hash: string | null;
    release_tx_hash: string | null;
    order_version: number;
  }>(
    `SELECT id, order_number, status, type, crypto_amount::text, fiat_amount::text,
            merchant_id, user_id, buyer_merchant_id,
            created_at::text, accepted_at::text, escrowed_at::text,
            payment_sent_at::text, payment_confirmed_at::text,
            completed_at::text, cancelled_at::text, expires_at::text,
            escrow_tx_hash, release_tx_hash, order_version
     FROM orders
     WHERE id::text ILIKE $1 OR order_number ILIKE $1
     LIMIT 5`,
    [`%${orderId}%`]
  );

  if (orders.length === 0) {
    return { tab: 'search', orders: [], events: [] };
  }

  // Get events for first matching order
  const events = await query<{
    id: string;
    event_type: string;
    actor_type: string;
    actor_id: string;
    old_status: string;
    new_status: string;
    created_at: string;
  }>(
    `SELECT id, event_type, actor_type, actor_id, old_status, new_status, created_at::text
     FROM order_events
     WHERE order_id = $1
     ORDER BY created_at ASC
     LIMIT 50`,
    [orders[0].id]
  );

  return {
    tab: 'search',
    orders,
    events,
  };
}
