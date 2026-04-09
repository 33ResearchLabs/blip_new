/**
 * Dynamic Rate API — Read-only endpoint
 *
 * Returns the current corridor reference price from corridor_prices table.
 * The price feed worker (core-api) is the single source of truth — it computes
 * VWAP with time decay every 30s and writes to corridor_prices.
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getFinalPrice } from '@/lib/price/usdtInrPrice';

const FALLBACK_RATES: Record<string, number> = {
  USDT_AED: 3.67,
  USDT_INR: 83.0,
};

export async function GET(request: NextRequest) {
  // Pair query: accepts usdt_aed / usdt_inr (lowercase) or USDT_AED / USDT_INR.
  // Defaults to USDT_AED for backward compatibility.
  const pairParam = (request.nextUrl.searchParams.get('pair') || 'usdt_aed').toLowerCase();
  const pairId = pairParam === 'usdt_inr' ? 'usdt_inr' : 'usdt_aed';
  const corridorId = pairId === 'usdt_inr' ? 'USDT_INR' : 'USDT_AED';
  const FALLBACK_RATE = FALLBACK_RATES[corridorId] ?? 3.67;

  // 1. Honor the admin's manual price (single source of truth used by the
  //    dashboard market card via /api/price). When the admin sets MANUAL mode,
  //    return that price. When in LIVE mode, getFinalPrice falls back to the
  //    latest tick. Either way, this matches what the merchant dashboard shows
  //    so the ConfigPanel calculates spreads off the same number.
  try {
    const finalPrice = await getFinalPrice(pairId);
    if (finalPrice.price > 0) {
      return NextResponse.json({
        success: true,
        data: {
          corridor_id: corridorId,
          ref_price: finalPrice.price,
          volume_5m: 0,
          avg_fill_time_sec: 0,
          active_merchants_count: 0,
          updated_at: new Date().toISOString(),
          calculation_method: finalPrice.mode === 'MANUAL' ? 'admin_manual' : 'live_tick',
          is_fallback: false,
          is_stale: false,
          confidence: finalPrice.mode === 'MANUAL' ? 'admin' : 'live',
        },
      });
    }
  } catch (err) {
    console.warn('[DynamicRate] getFinalPrice failed, falling back to corridor VWAP:', err);
  }

  try {
    const rows = await query<{
      corridor_id: string;
      ref_price: string;
      volume_5m: string;
      confidence: string;
      updated_at: Date;
    }>(
      `SELECT corridor_id, ref_price, volume_5m, confidence, updated_at
       FROM corridor_prices
       WHERE corridor_id = $1`,
      [corridorId]
    );

    if (!rows[0]) {
      return NextResponse.json({
        success: true,
        data: {
          corridor_id: corridorId,
          ref_price: FALLBACK_RATE,
          volume_5m: 0,
          avg_fill_time_sec: 0,
          active_merchants_count: 0,
          updated_at: new Date().toISOString(),
          calculation_method: 'fallback',
          orders_analyzed: 0,
          is_fallback: true,
          confidence: 'low',
        },
      });
    }

    const row = rows[0];
    const ageMs = Date.now() - new Date(row.updated_at).getTime();

    return NextResponse.json({
      success: true,
      data: {
        corridor_id: row.corridor_id,
        ref_price: parseFloat(row.ref_price),
        volume_5m: parseFloat(row.volume_5m || '0'),
        avg_fill_time_sec: 0,
        active_merchants_count: 0,
        updated_at: row.updated_at,
        calculation_method: 'worker_vwap',
        is_fallback: false,
        is_stale: ageMs > 5 * 60 * 1000,
        confidence: row.confidence || 'low',
      },
    });
  } catch (error) {
    console.error('[DynamicRate] Error reading corridor price:', error);

    return NextResponse.json({
      success: true,
      data: {
        corridor_id: corridorId,
        ref_price: FALLBACK_RATE,
        volume_5m: 0,
        avg_fill_time_sec: 0,
        active_merchants_count: 0,
        updated_at: new Date().toISOString(),
        calculation_method: 'fallback',
        orders_analyzed: 0,
        is_fallback: true,
        confidence: 'low',
      },
    });
  }
}
