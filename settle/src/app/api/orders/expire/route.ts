import { NextRequest, NextResponse } from 'next/server';
import { proxyCoreApi } from '@/lib/proxy/coreApi';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';

// How long payment_sent can stay before auto-dispute (24 hours)
const PAYMENT_SENT_TIMEOUT_HOURS = 24;

export async function POST(request: NextRequest) {
  // Require admin auth for expiring orders — always enforced
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  try {
    // 1. Original expire logic (pending/open orders)
    const expireResponse = await proxyCoreApi('/v1/orders/expire', { method: 'POST' });

    // 2. Auto-dispute stuck payment_sent orders (24h timeout)
    let timedOutCount = 0;
    try {
      const stuckOrders = await query<{ id: string; user_id: string; merchant_id: string }>(
        `UPDATE orders
         SET status = 'disputed',
             dispute_reason = 'auto_timeout',
             dispute_description = 'Payment confirmation not received within ${PAYMENT_SENT_TIMEOUT_HOURS} hours — auto-disputed for review',
             disputed_at = NOW(),
             updated_at = NOW(),
             order_version = order_version + 1
         WHERE status = 'payment_sent'
           AND payment_sent_at < NOW() - INTERVAL '${PAYMENT_SENT_TIMEOUT_HOURS} hours'
           AND payment_sent_at IS NOT NULL
         RETURNING id, user_id, merchant_id`,
      );
      timedOutCount = stuckOrders.length;
      if (timedOutCount > 0) {
        logger.warn('[Expire] Auto-disputed stuck payment_sent orders', {
          count: timedOutCount,
          orderIds: stuckOrders.map(o => o.id),
        });
      }
    } catch (err) {
      logger.error('[Expire] Failed to auto-dispute stuck orders', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Return combined result
    const expireData = await expireResponse.json();
    return NextResponse.json({
      ...expireData,
      payment_sent_timed_out: timedOutCount,
    });
  } catch (error) {
    console.error('Error expiring orders:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to expire orders' },
      { status: 500 }
    );
  }
}

// Also allow GET for cron jobs
export async function GET(request: NextRequest) {
  return POST(request);
}
