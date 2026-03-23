import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/middleware/auth';

export const dynamic = 'force-dynamic';

// GET /api/orders/status?order_numbers=BM-123,BM-456
// Returns live status for orders by order_number (batch lookup)
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const orderNumbers = request.nextUrl.searchParams.get('order_numbers');
  if (!orderNumbers) {
    return NextResponse.json({ success: false, error: 'order_numbers required' }, { status: 400 });
  }

  const numbers = orderNumbers.split(',').slice(0, 20); // max 20 at once

  const rows = await query<{ order_number: string; status: string }>(
    `SELECT order_number, status FROM orders WHERE order_number = ANY($1)`,
    [numbers]
  );

  const statuses: Record<string, string> = {};
  for (const row of rows) {
    statuses[row.order_number] = row.status;
  }

  return NextResponse.json({ success: true, data: statuses });
}
