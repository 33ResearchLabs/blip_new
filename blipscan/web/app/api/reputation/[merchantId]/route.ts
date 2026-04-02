import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/app/lib/db';

/**
 * Read-only reputation endpoint for BlipScan.
 * Reads from reputation_scores table (populated by Core API worker).
 * No calculation — just reads.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { merchantId: string } }
) {
  try {
    // Resolve merchant ID (could be UUID or wallet address)
    const merchantRes = await pool.query(
      `SELECT id, wallet_address FROM merchants WHERE id::text = $1 OR wallet_address = $1 LIMIT 1`,
      [params.merchantId]
    );

    if (merchantRes.rows.length === 0) {
      return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
    }

    const merchant = merchantRes.rows[0];

    // Read reputation from reputation_scores table
    const repRes = await pool.query(
      `SELECT total_score, review_score, execution_score, volume_score, consistency_score, trust_score,
              tier, badges, calculated_at
       FROM reputation_scores WHERE entity_id = $1 AND entity_type = 'merchant'`,
      [merchant.id]
    );

    if (repRes.rows.length === 0) {
      // No reputation calculated yet — return defaults
      return NextResponse.json({
        total_score: 0,
        tier: 'newcomer',
        badges: [],
        breakdown: {
          reliability: { raw: 0, weighted: 0, weight: 40 },
          volume: { raw: 0, weighted: 0, weight: 15 },
          speed: { raw: 0, weighted: 0, weight: 15 },
          liquidity: { raw: 0, weighted: 0, weight: 10 },
          trust: { raw: 0, weighted: 0, weight: 20 },
        },
        penalties: [],
        abuse_flags: [],
        wash_trading_detected: false,
        trade_count: 0,
        cold_start: true,
        calculated_at: null,
      });
    }

    const rep = repRes.rows[0];

    return NextResponse.json({
      total_score: rep.total_score,
      tier: rep.tier,
      badges: rep.badges || [],
      breakdown: {
        reliability: { raw: rep.execution_score, weighted: Math.round(rep.execution_score * 40 / 100), weight: 40 },
        volume: { raw: rep.volume_score, weighted: Math.round(rep.volume_score * 15 / 100), weight: 15 },
        speed: { raw: rep.consistency_score, weighted: Math.round(rep.consistency_score * 15 / 100), weight: 15 },
        liquidity: { raw: rep.trust_score, weighted: Math.round(rep.trust_score * 10 / 100), weight: 10 },
        trust: { raw: rep.review_score, weighted: Math.round(rep.review_score * 20 / 100), weight: 20 },
      },
      penalties: [],
      abuse_flags: [],
      wash_trading_detected: false,
      trade_count: 0,
      cold_start: false,
      calculated_at: rep.calculated_at,
    });
  } catch (error) {
    console.error('Error reading reputation:', error);
    return NextResponse.json({ error: 'Failed to read reputation' }, { status: 500 });
  }
}
