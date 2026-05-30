import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

// Promo: first 10 orders placed after this timestamp get $5 off
const PROMO_START = '2026-05-30 17:00:00';
const PROMO_LIMIT = 10;
const PROMO_DISCOUNT_USDT = 5; // $5 worth of USDT

export async function GET() {
  try {
    const row = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM orders WHERE created_at > $1`,
      [PROMO_START],
    );
    const used = parseInt(row?.count ?? '0', 10);
    const remaining = Math.max(0, PROMO_LIMIT - used);
    return NextResponse.json({
      success: true,
      data: {
        active: remaining > 0,
        remaining,
        total: PROMO_LIMIT,
        discount_usdt: PROMO_DISCOUNT_USDT,
      },
    });
  } catch {
    return NextResponse.json({
      success: true,
      data: { active: false, remaining: 0, total: PROMO_LIMIT, discount_usdt: PROMO_DISCOUNT_USDT },
    });
  }
}
