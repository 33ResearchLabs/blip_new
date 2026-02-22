import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import {
  successResponse,
  errorResponse,
  validationErrorResponse,
} from '@/lib/middleware/auth';

// Matching engine: Find best matching order based on spread preference, reputation, and time
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Required parameters
    const orderType = searchParams.get('type'); // 'buy' or 'sell'
    const paymentMethod = searchParams.get('payment_method');
    const cryptoAmount = searchParams.get('crypto_amount');
    const excludeMerchantId = searchParams.get('exclude_merchant_id');

    // Validate required params
    if (!orderType || !paymentMethod || !cryptoAmount) {
      return validationErrorResponse([
        'Missing required parameters: type, payment_method, crypto_amount'
      ]);
    }

    const amount = parseFloat(cryptoAmount);
    if (isNaN(amount) || amount <= 0) {
      return validationErrorResponse(['Invalid crypto_amount']);
    }

    // Find matching orders using the database function
    // We look for opposite type (if user wants to buy, we find sell orders)
    const oppositeType = orderType === 'buy' ? 'sell' : 'buy';

    const sql = `
      SELECT
        o.id,
        o.merchant_id,
        o.crypto_amount,
        o.fiat_amount,
        o.rate,
        o.spread_preference,
        o.protocol_fee_percentage,
        o.status,
        o.escrow_tx_hash,
        o.escrow_trade_id,
        o.escrow_trade_pda,
        o.escrow_creator_wallet,
        o.created_at,
        m.display_name as merchant_name,
        m.rating as merchant_rating,
        m.total_trades as merchant_total_trades,
        m.avg_response_time_mins as merchant_response_time,
        m.wallet_address as merchant_wallet,
        -- Calculate priority score for matching
        CASE
          WHEN o.spread_preference = 'best' THEN 100
          WHEN o.spread_preference = 'fastest' THEN 75
          WHEN o.spread_preference = 'cheap' THEN 50
          ELSE 0
        END +
        (m.rating * 10) +
        (CASE WHEN m.avg_response_time_mins < 5 THEN 20 ELSE 0 END) as match_priority_score
      FROM orders o
      JOIN merchants m ON o.merchant_id = m.id
      WHERE o.type = $1
        AND o.payment_method = $2
        AND o.crypto_amount >= $3 * 0.9  -- Allow 10% variance
        AND o.crypto_amount <= $3 * 1.1
        AND o.status IN ('pending', 'escrowed')
        ${excludeMerchantId ? 'AND o.merchant_id != $4' : ''}
      ORDER BY match_priority_score DESC, o.created_at ASC
      LIMIT 10
    `;

    const params = excludeMerchantId
      ? [oppositeType, paymentMethod, amount, excludeMerchantId]
      : [oppositeType, paymentMethod, amount];

    const results = await query<any>(sql, params);

    if (results.length === 0) {
      logger.warn('No matching orders found', {
        orderType,
        paymentMethod,
        amount,
        excludeMerchantId
      });
      return NextResponse.json(
        {
          success: false,
          error: 'No matching orders found. Try adjusting the amount or wait for new orders.',
          data: []
        },
        { status: 404 }
      );
    }

    // Return best match (first result) or all matches
    const bestMatch = results[0];

    logger.info('Order match found', {
      orderId: bestMatch.id,
      merchantId: bestMatch.merchant_id,
      merchantName: bestMatch.merchant_name,
      spreadPreference: bestMatch.spread_preference,
      priorityScore: bestMatch.match_priority_score,
      totalMatches: results.length
    });

    logger.api.request('GET', '/api/orders/match');

    return successResponse({
      bestMatch,
      allMatches: results,
      totalMatches: results.length
    });
  } catch (error) {
    logger.api.error('GET', '/api/orders/match', error as Error);
    return errorResponse('Internal server error');
  }
}

// Get order book statistics
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, payment_method } = body;

    // Get order book statistics by spread preference
    const sql = `
      SELECT
        o.spread_preference,
        COUNT(*) as order_count,
        AVG(o.crypto_amount) as avg_amount,
        MIN(o.rate) as best_rate,
        MAX(o.rate) as worst_rate,
        AVG(o.protocol_fee_percentage) as avg_fee
      FROM orders o
      WHERE o.status IN ('pending', 'escrowed')
        ${type ? 'AND o.type = $1' : ''}
        ${payment_method ? `AND o.payment_method = ${type ? '$2' : '$1'}` : ''}
      GROUP BY o.spread_preference
      ORDER BY
        CASE o.spread_preference
          WHEN 'best' THEN 1
          WHEN 'fastest' THEN 2
          WHEN 'cheap' THEN 3
        END
    `;

    const params: string[] = [];
    if (type) params.push(type);
    if (payment_method) params.push(payment_method);

    const results = await query(sql, params);

    logger.api.request('POST', '/api/orders/match (stats)');

    return successResponse({
      statistics: results,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.api.error('POST', '/api/orders/match (stats)', error as Error);
    return errorResponse('Internal server error');
  }
}
