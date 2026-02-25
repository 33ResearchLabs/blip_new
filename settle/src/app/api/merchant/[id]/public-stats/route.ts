import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { getMerchantOffers } from '@/lib/db/repositories/merchants';
import { uuidSchema } from '@/lib/validation/schemas';
import {
  verifyMerchant,
  validationErrorResponse,
  notFoundResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';

/**
 * GET /api/merchant/[id]/public-stats
 *
 * Unauthenticated endpoint returning public-safe merchant data:
 * - Recent completed orders (no counterparty info)
 * - Reviews with text (no rater IDs)
 * - Active offers (no IBAN/account details)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const idValidation = uuidSchema.safeParse(id);
    if (!idValidation.success) {
      return validationErrorResponse(['Invalid merchant ID format']);
    }

    const merchantExists = await verifyMerchant(id);
    if (!merchantExists) {
      return notFoundResponse('Merchant');
    }

    const [recentOrders, reviews, allOffers] = await Promise.all([
      query(
        `SELECT id, type, payment_method, fiat_amount, fiat_currency, created_at, completed_at
         FROM orders
         WHERE merchant_id = $1 AND status = 'completed'
         ORDER BY completed_at DESC
         LIMIT 10`,
        [id]
      ),
      query(
        `SELECT id, rating, review_text, rater_type, created_at
         FROM ratings
         WHERE rated_type = 'merchant' AND rated_id = $1
           AND review_text IS NOT NULL AND review_text != ''
         ORDER BY created_at DESC
         LIMIT 20`,
        [id]
      ),
      getMerchantOffers(id),
    ]);

    const activeOffers = allOffers
      .filter((o) => o.is_active)
      .map((o) => ({
        id: o.id,
        type: o.type,
        payment_method: o.payment_method,
        rate: o.rate,
        min_amount: o.min_amount,
        max_amount: o.max_amount,
        available_amount: o.available_amount,
        bank_name: o.bank_name,
      }));

    const res = successResponse({ recentOrders, reviews, activeOffers });
    res.headers.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    return res;
  } catch (error) {
    console.error('[API] GET /api/merchant/[id]/public-stats error:', error);
    return errorResponse('Internal server error');
  }
}
