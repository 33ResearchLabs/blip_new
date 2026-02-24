/**
 * Dynamic Rate API — Read-only endpoint
 *
 * Returns the current corridor reference price from corridor_prices table.
 * The price feed worker (core-api) is the single source of truth — it computes
 * VWAP with time decay every 30s and writes to corridor_prices.
 */

import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

const FALLBACK_RATE = 3.67;

export async function GET() {
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
       WHERE corridor_id = 'USDT_AED'`,
      []
    );

    if (!rows[0]) {
      return NextResponse.json({
        success: true,
        data: {
          corridor_id: 'USDT_AED',
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
        corridor_id: 'USDT_AED',
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
