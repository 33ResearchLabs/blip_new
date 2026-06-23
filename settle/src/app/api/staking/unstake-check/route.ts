/**
 * GET /api/staking/unstake-check
 *
 * App-layer gate the unstake UI calls BEFORE building the on-chain unstake tx:
 *   - Rule 5: blocked if the actor used their (stake-boosted) limit on an order
 *     in the last 24h — must wait 24h after the last order.
 *   - Rule 4: returns the original staking wallet so the UI can require the user
 *     to reconnect it (the on-chain program also enforces only that wallet can
 *     unstake). NOTE: this is an app-layer gate; the hard on-chain controls are
 *     the 30-day lock + 10% early-unstake fee.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTokenAuth, successResponse, forbiddenResponse } from "@/lib/middleware/auth";
import { queryOne } from "@/lib/db";
import { getLastLimitOrderAt } from "@/lib/coins/limits";

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const auth = await requireTokenAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== "user" && auth.actorType !== "merchant") {
    return forbiddenResponse("Staking requires a user or merchant token");
  }

  const lastOrderAt = await getLastLimitOrderAt(auth.actorId, auth.actorType);
  let allowed = true;
  let reason: string | null = null;
  let waitUntilMs: number | null = null;
  if (lastOrderAt) {
    const elapsed = Date.now() - new Date(lastOrderAt).getTime();
    if (elapsed < COOLDOWN_MS) {
      allowed = false;
      waitUntilMs = new Date(lastOrderAt).getTime() + COOLDOWN_MS;
      const hrs = Math.ceil((COOLDOWN_MS - elapsed) / 3_600_000);
      reason = `You used your limit on a recent order. You can unstake ~${hrs}h after your last order.`;
    }
  }

  const pos = await queryOne<{ staking_wallet_address: string | null }>(
    `SELECT staking_wallet_address FROM staking_positions
      WHERE account_type = $1 AND account_id = $2`,
    [auth.actorType, auth.actorId],
  );

  return successResponse({
    allowed,
    reason,
    waitUntilMs,
    stakingWallet: pos?.staking_wallet_address ?? null,
  });
}
