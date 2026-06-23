/**
 * POST /api/staking/sync
 *
 * Mirrors the on-chain blip_staking position into staking_positions.principal so
 * the trading-limit computation (which reads principal) reflects on-chain truth.
 * Call this after a stake/unstake tx confirms. The on-chain StakePosition is the
 * source of truth; this endpoint never moves funds — it only reconciles the DB
 * number to whatever the chain says for the actor's wallet.
 *
 * Rewards: accrual is materialized at the OLD principal up to now before the new
 * principal takes effect, so switching the principal can't retroactively change
 * already-earned rewards. Rewards themselves remain a DB concept (8% APY).
 */
import { NextRequest, NextResponse } from "next/server";
import {
  requireTokenAuth,
  successResponse,
  errorResponse,
  forbiddenResponse,
} from "@/lib/middleware/auth";
import { queryOne, transaction } from "@/lib/db";
import { Connection, PublicKey } from "@solana/web3.js";
import { DEVNET_RPC } from "@/lib/solana/v2/config";
import { readStakedAmountUsdt } from "@/lib/solana/staking";
import { computePending, STAKE_APY_BPS } from "@/lib/staking/economy";

export async function POST(request: NextRequest) {
  const auth = await requireTokenAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== "user" && auth.actorType !== "merchant") {
    return forbiddenResponse("Staking requires a user or merchant token");
  }

  // Resolve the actor's on-chain wallet address (server-side, not client-supplied).
  const table = auth.actorType === "user" ? "users" : "merchants";
  const row = await queryOne<{ wallet_address: string | null }>(
    `SELECT wallet_address FROM ${table} WHERE id = $1`,
    [auth.actorId],
  );
  if (!row?.wallet_address) {
    return errorResponse("No wallet address on file for this account", 400);
  }

  // Read on-chain staked principal.
  let onchain: number;
  try {
    const conn = new Connection(DEVNET_RPC, "confirmed");
    onchain = await readStakedAmountUsdt(conn, new PublicKey(row.wallet_address));
  } catch (err) {
    console.error("[staking/sync] on-chain read failed", err);
    return errorResponse("Could not read on-chain stake");
  }

  // Reconcile DB principal to the on-chain amount (atomic + row-locked).
  try {
    const result = await transaction(async (client) => {
      await client.query(
        `INSERT INTO staking_positions (account_type, account_id, apy_bps)
         VALUES ($1, $2, $3) ON CONFLICT (account_type, account_id) DO NOTHING`,
        [auth.actorType, auth.actorId, STAKE_APY_BPS],
      );
      const posRes = await client.query<{
        principal: string;
        accrued_rewards: string;
        lifetime_rewards: string;
        apy_bps: number;
        last_accrued_at: Date;
      }>(
        `SELECT principal, accrued_rewards, lifetime_rewards, apy_bps, last_accrued_at
           FROM staking_positions
          WHERE account_type = $1 AND account_id = $2 FOR UPDATE`,
        [auth.actorType, auth.actorId],
      );
      const pos = posRes.rows[0];
      const oldPrincipal = Number(pos.principal);
      // Materialize accrual at the OLD principal up to now.
      const pending = computePending(oldPrincipal, pos.apy_bps, pos.last_accrued_at, new Date());
      const newAccrued = Number(pos.accrued_rewards) + pending;

      await client.query(
        `UPDATE staking_positions
            SET principal = $3, accrued_rewards = $4, last_accrued_at = NOW(), updated_at = NOW()
          WHERE account_type = $1 AND account_id = $2`,
        [auth.actorType, auth.actorId, onchain, newAccrued],
      );

      const delta = onchain - oldPrincipal;
      if (delta !== 0) {
        await client.query(
          `INSERT INTO staking_events
             (account_type, account_id, event_type, amount, principal_after, rewards_after, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            auth.actorType,
            auth.actorId,
            delta > 0 ? "STAKE" : "UNSTAKE",
            Math.abs(delta),
            onchain,
            newAccrued,
            JSON.stringify({ source: "onchain-sync", wallet: row.wallet_address }),
          ],
        );
      }
      return { principal: onchain, accrued_rewards: newAccrued };
    });
    return successResponse(result);
  } catch (err) {
    console.error("[staking/sync] db reconcile failed", err);
    return errorResponse("Staking sync failed");
  }
}
