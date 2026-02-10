import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { calculateCorridorScores, BlipScoreBreakdown, MerchantStats, SortOption, sortByBlipScore, sortByPrice, sortBySpeed, sortByReliability } from '@/lib/scoring/blipScore';
import { logger } from '@/lib/logger';

/**
 * Marketplace Offers API
 *
 * Returns all active offers with BlipScore rankings.
 * Offers are grouped by corridor (crypto_currency + fiat_currency + type + payment_method).
 *
 * Query params:
 * - type: 'buy' | 'sell' (filter by offer type)
 * - payment_method: 'bank' | 'cash' (filter by payment method)
 * - sort: 'best' | 'cheapest' | 'fastest' | 'reliable' (default: 'best')
 * - fiat_currency: string (e.g., 'AED', 'USD')
 * - exclude_merchant_id: UUID (exclude a specific merchant's offers, useful for marketplace view)
 */

interface MarketplaceOffer {
  id: string;
  merchant_id: string;
  type: 'buy' | 'sell';
  payment_method: 'bank' | 'cash';
  rate: number;
  min_amount: number;
  max_amount: number;
  available_amount: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Merchant info
  merchant: {
    id: string;
    display_name: string;
    business_name: string;
    rating: number;
    rating_count: number;
    total_trades: number;
    total_volume: number;
    avg_response_time_mins: number;
    is_online: boolean;
    wallet_address: string | null;
  };
  // Payment details
  bank_name?: string;
  location_name?: string;
  // BlipScore (added in response)
  blipScore?: BlipScoreBreakdown;
  // Corridor identifier
  corridor?: string;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type');
    const paymentMethod = searchParams.get('payment_method');
    const sortBy = (searchParams.get('sort') || 'best') as SortOption;
    const fiatCurrency = searchParams.get('fiat_currency');
    const excludeMerchantId = searchParams.get('exclude_merchant_id');

    // Build query with filters
    let sql = `
      SELECT
        o.id,
        o.merchant_id,
        o.type,
        o.payment_method,
        o.rate,
        o.min_amount,
        o.max_amount,
        o.available_amount,
        o.is_active,
        o.bank_name,
        o.location_name,
        o.created_at,
        o.updated_at,
        json_build_object(
          'id', m.id,
          'display_name', m.display_name,
          'business_name', m.business_name,
          'rating', m.rating,
          'rating_count', m.rating_count,
          'total_trades', m.total_trades,
          'total_volume', m.total_volume,
          'avg_response_time_mins', m.avg_response_time_mins,
          'is_online', m.is_online,
          'wallet_address', m.wallet_address
        ) as merchant
      FROM merchant_offers o
      JOIN merchants m ON o.merchant_id = m.id
      WHERE o.is_active = true
        AND m.status = 'active'
        AND m.is_online = true
        AND o.available_amount > 0
    `;

    const params: unknown[] = [];
    let paramIndex = 1;

    if (type && (type === 'buy' || type === 'sell')) {
      sql += ` AND o.type = $${paramIndex++}`;
      params.push(type);
    }

    if (paymentMethod && (paymentMethod === 'bank' || paymentMethod === 'cash')) {
      sql += ` AND o.payment_method = $${paramIndex++}`;
      params.push(paymentMethod);
    }

    if (excludeMerchantId) {
      sql += ` AND o.merchant_id != $${paramIndex++}`;
      params.push(excludeMerchantId);
    }

    // Note: fiat_currency would require a schema change to add to offers
    // For now, we assume all offers are in AED (as per current system)

    sql += ' ORDER BY o.rate ASC, m.rating DESC';

    const offers = await query<MarketplaceOffer>(sql, params);

    // Calculate BlipScores for each offer
    const offersForScoring = offers.map(offer => ({
      id: offer.id,
      rate: Number(offer.rate),
      type: offer.type,
      merchantStats: {
        rating: Number(offer.merchant.rating) || 5.0,
        ratingCount: Number(offer.merchant.rating_count) || 0,
        totalTrades: Number(offer.merchant.total_trades) || 0,
        totalVolume: Number(offer.merchant.total_volume) || 0,
        avgResponseTimeMins: Number(offer.merchant.avg_response_time_mins) || 5,
      } as MerchantStats,
    }));

    const scores = calculateCorridorScores(offersForScoring);

    // Attach scores and corridor info to offers
    const scoredOffers = offers.map(offer => ({
      ...offer,
      rate: Number(offer.rate),
      min_amount: Number(offer.min_amount),
      max_amount: Number(offer.max_amount),
      available_amount: Number(offer.available_amount),
      blipScore: scores.get(offer.id),
      corridor: `USDC-AED-${offer.type}-${offer.payment_method}`,
      // Also add merchantStats for sorting functions
      merchantStats: {
        rating: Number(offer.merchant.rating) || 5.0,
        ratingCount: Number(offer.merchant.rating_count) || 0,
        totalTrades: Number(offer.merchant.total_trades) || 0,
        totalVolume: Number(offer.merchant.total_volume) || 0,
        avgResponseTimeMins: Number(offer.merchant.avg_response_time_mins) || 5,
      } as MerchantStats,
    }));

    // Apply sorting
    let sortedOffers;
    switch (sortBy) {
      case 'cheapest':
        sortedOffers = sortByPrice(scoredOffers);
        break;
      case 'fastest':
        sortedOffers = sortBySpeed(scoredOffers);
        break;
      case 'reliable':
        sortedOffers = sortByReliability(scoredOffers);
        break;
      case 'best':
      default:
        // For best overall, prioritize trusted offers first
        const trusted = scoredOffers.filter(o => o.blipScore?.isTrusted);
        const untrusted = scoredOffers.filter(o => !o.blipScore?.isTrusted);
        sortedOffers = [...sortByBlipScore(trusted), ...sortByBlipScore(untrusted)];
        break;
    }

    logger.api.request('GET', '/api/marketplace/offers');

    return NextResponse.json({
      success: true,
      data: sortedOffers,
      meta: {
        total: sortedOffers.length,
        sortBy,
        filters: {
          type: type || 'all',
          payment_method: paymentMethod || 'all',
          fiat_currency: fiatCurrency || 'AED',
        },
      },
    });
  } catch (error) {
    logger.api.error('GET', '/api/marketplace/offers', error as Error);
    console.error('[Marketplace API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
