/**
 * GET /api/orders/active-count
 * Count of in-progress orders for the authed actor (escrowed / accepted /
 * payment_sent). Used to block wallet disconnect while a trade is live, so a
 * user can't strand an escrow they still need to release/refund.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, successResponse } from "@/lib/middleware/auth";
import { queryOne } from "@/lib/db";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const actorCol =
    auth.actorType === "merchant"
      ? "(merchant_id = $1 OR buyer_merchant_id = $1)"
      : "user_id = $1";
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM orders
      WHERE ${actorCol} AND status IN ('escrowed','accepted','payment_sent')`,
    [auth.actorId],
  );
  return successResponse({ active: row?.n ?? 0 });
}
