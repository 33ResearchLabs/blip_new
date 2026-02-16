/**
 * Dynamic Rate API - VWAP with Time Decay
 *
 * Calculates fair market rate based on completed orders in last 6 hours
 * Uses volume-weighted average with time decay for recency bias
 */

import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

const FALLBACK_RATE = 3.67;
const MIN_ORDERS_REQUIRED = 5;
const LOOKBACK_HOURS = 6;
const OUTLIER_THRESHOLD = 0.15; // 15% deviation from median

interface OrderData {
  amount_aed: number;
  rate: number;
  completed_at: Date;
  age_hours: number;
}

/**
 * Calculate time weight based on order age
 * - Last 1 hour: 1.0
 * - 1-3 hours: 0.7
 * - 3-6 hours: 0.3
 */
function getTimeWeight(ageHours: number): number {
  if (ageHours <= 1) return 1.0;
  if (ageHours <= 3) return 0.7;
  if (ageHours <= 6) return 0.3;
  return 0;
}

/**
 * Calculate median rate (for outlier detection)
 */
function getMedian(rates: number[]): number {
  const sorted = [...rates].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Calculate VWAP with time decay
 */
function calculateVWAP(orders: OrderData[]): number {
  if (orders.length < MIN_ORDERS_REQUIRED) {
    return FALLBACK_RATE;
  }

  // Extract rates for median calculation
  const rates = orders.map(o => o.rate);
  const medianRate = getMedian(rates);

  // Filter outliers (rates >15% away from median)
  const validOrders = orders.filter(order => {
    const deviation = Math.abs(order.rate - medianRate) / medianRate;
    return deviation <= OUTLIER_THRESHOLD;
  });

  if (validOrders.length < MIN_ORDERS_REQUIRED) {
    return FALLBACK_RATE;
  }

  // Calculate VWAP with time decay
  let weightedSum = 0;
  let totalWeight = 0;

  for (const order of validOrders) {
    const timeWeight = getTimeWeight(order.age_hours);
    const weight = order.amount_aed * timeWeight;

    weightedSum += order.rate * weight;
    totalWeight += weight;
  }

  const vwap = totalWeight > 0 ? weightedSum / totalWeight : FALLBACK_RATE;

  // Round to 4 decimals
  return Math.round(vwap * 10000) / 10000;
}

export async function GET() {
  try {
    // Fetch completed orders from last 6 hours
    const result = await query(
      `SELECT
        fiat_amount as amount_aed,
        rate::numeric as rate,
        completed_at,
        EXTRACT(EPOCH FROM (NOW() - completed_at)) / 3600 as age_hours
       FROM orders
       WHERE status = 'completed'
         AND completed_at > NOW() - INTERVAL '${LOOKBACK_HOURS} hours'
         AND fiat_amount > 0
         AND rate > 0
       ORDER BY completed_at DESC`,
      []
    );

    const orders = result as OrderData[];

    // Calculate dynamic rate
    const calculatedRate = calculateVWAP(orders);
    const isUsingFallback = orders.length < MIN_ORDERS_REQUIRED;

    return NextResponse.json({
      success: true,
      data: {
        corridor_id: 'USDT_AED',
        ref_price: calculatedRate,
        volume_5m: 0, // Can be calculated if needed
        avg_fill_time_sec: 0, // Can be calculated if needed
        active_merchants_count: 0, // Can be calculated if needed
        updated_at: new Date().toISOString(),

        // Additional metadata
        calculation_method: 'vwap_time_decay',
        orders_analyzed: orders.length,
        is_fallback: isUsingFallback,
        confidence: isUsingFallback ? 'low' : orders.length >= 20 ? 'high' : 'medium',
      },
    });
  } catch (error) {
    console.error('[DynamicRate] Error calculating rate:', error);

    // Return fallback rate on error
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
