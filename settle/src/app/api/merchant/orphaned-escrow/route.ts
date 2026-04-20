import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  successResponse,
  errorResponse,
  validationErrorResponse,
} from "@/lib/middleware/auth";
import { query } from "@/lib/db";
import { logger } from "settlement-core";

/**
 * POST /api/merchant/orphaned-escrow
 *
 * Records an orphaned escrow — funds locked on-chain but order creation
 * failed. Allows admin to find and refund the stuck escrow.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const {
      escrow_tx_hash,
      merchant_id,
      amount,
      error_message,
      escrow_trade_id,
      escrow_trade_pda,
      escrow_pda,
      escrow_creator_wallet,
    } = body;

    if (!escrow_tx_hash || !merchant_id || !amount) {
      return validationErrorResponse([
        "escrow_tx_hash, merchant_id, and amount are required",
      ]);
    }

    // Verify the authenticated merchant matches
    if (auth.actorType === "merchant" && auth.actorId !== merchant_id) {
      return errorResponse("Unauthorized");
    }

    await query(
      `INSERT INTO orphaned_escrows
        (escrow_tx_hash, merchant_id, amount, error_message, escrow_trade_id, escrow_trade_pda, escrow_pda, escrow_creator_wallet)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING`,
      [
        escrow_tx_hash,
        merchant_id,
        amount,
        error_message || null,
        escrow_trade_id || null,
        escrow_trade_pda || null,
        escrow_pda || null,
        escrow_creator_wallet || null,
      ],
    );

    logger.api.error(
      "POST",
      "/api/merchant/orphaned-escrow",
      new Error(
        `Orphaned escrow recorded: ${escrow_tx_hash} for merchant ${merchant_id}, amount ${amount}`,
      ),
    );

    return successResponse({ recorded: true });
  } catch (error) {
    logger.api.error("POST", "/api/merchant/orphaned-escrow", error as Error);
    return errorResponse("Failed to record orphaned escrow");
  }
}
