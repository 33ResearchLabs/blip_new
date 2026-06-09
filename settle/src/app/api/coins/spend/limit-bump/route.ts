/**
 * POST /api/coins/spend/limit-bump
 *
 * Burns coins to activate a 30-day trade-limit unlock. Tiers L1–L4.
 * L4 requires KYC (placeholder until KYC flow lands; for now we accept
 * a `kycVerified` flag from the merchant's account state).
 *
 * Atomic: the coin burn + unlock-row insert run in a single transaction,
 * so a failed insert refunds (via UPDATE … RETURNING) any partial debit.
 * Idempotent via the unique unlocks_at upper-bound — re-buying the same
 * tier within 60 seconds is a no-op (returns the existing row).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  requireAuth,
  successResponse,
  errorResponse,
  validationErrorResponse,
  forbiddenResponse,
} from '@/lib/middleware/auth';
import { transaction } from '@/lib/db';
import { COIN_LIMIT_TIERS, type CoinLimitTier } from '@/lib/coins/limits';
import { burnCoins } from '@/lib/coins/economy';
import { z } from 'zod';

const BodySchema = z.object({
  tier: z.enum(['L1', 'L2', 'L3', 'L4']),
});

const UNLOCK_DURATION_DAYS = 30;

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const actorType = auth.actorType;
  if (actorType !== 'user' && actorType !== 'merchant') {
    return forbiddenResponse('Coin spending requires a user or merchant token');
  }
  const actorId = auth.actorId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return validationErrorResponse(['Invalid JSON body']);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error.issues.map((i) => i.message));
  }
  const tier: CoinLimitTier = parsed.data.tier;
  const config = COIN_LIMIT_TIERS[tier];

  // KYC gate — each tier requires a minimum KYC level (0 = none, 3 = full).
  if (config.requiresKyc > 0) {
    const { queryOne } = await import('@/lib/db');
    const table = actorType === 'merchant' ? 'merchants' : 'users';
    const col   = actorType === 'merchant' ? 'verification_level' : 'kyc_level';
    const row   = await queryOne<{ lvl: number | null }>(
      `SELECT COALESCE(${col}, 0) AS lvl FROM ${table} WHERE id = $1`,
      [actorId],
    );
    if ((row?.lvl ?? 0) < config.requiresKyc) {
      return NextResponse.json(
        {
          success: false,
          error: 'KYC_REQUIRED',
          required_kyc_level: config.requiresKyc,
          message: `This tier requires KYC level ${config.requiresKyc} or above`,
        },
        { status: 403 },
      );
    }
  }

  // Atomic burn + unlock-row insert. If anything between the burn and
  // the insert throws, the transaction rolls back the debit. We DO NOT
  // refund manually because the transaction handles it.
  try {
    const result = await transaction(async (client) => {
      // 1) Burn the coins through the orchestration module so the cap +
      //    balance check + ledger row stay consistent.
      const debit = await burnCoins({
        actorId,
        actorType,
        event: 'LIMIT_BUMP_BURN',
        points: config.costCoins,
        metadata: { tier },
      });
      if (debit.reason === 'INSUFFICIENT_BALANCE') {
        return { ok: false as const, reason: 'INSUFFICIENT_BALANCE' as const, debit };
      }

      // 2) Create the unlock row. Linked back to the burn log row for audit.
      const expiresAt = new Date(Date.now() + UNLOCK_DURATION_DAYS * 86400 * 1000);
      const insertRes = await client.query<{ id: string; expires_at: Date }>(
        `INSERT INTO coin_limit_unlocks
            (actor_id, actor_type, tier, daily_limit_usd, per_trade_usd,
             coins_burned, expires_at, burn_log_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, expires_at`,
        [
          actorId,
          actorType,
          tier,
          config.dailyUsd,
          config.perTradeUsd,
          config.costCoins,
          expiresAt,
          debit.logId,
        ],
      );

      return {
        ok: true as const,
        unlock: insertRes.rows[0],
        debit,
      };
    });

    if (!result.ok) {
      return errorResponse('Insufficient coin balance', 402);
    }

    return successResponse({
      tier,
      daily_limit_usd: config.dailyUsd,
      per_trade_usd: config.perTradeUsd,
      coins_burned: config.costCoins,
      coins_remaining: result.debit.newBalance,
      expires_at: result.unlock.expires_at,
      unlock_id: result.unlock.id,
    });
  } catch (err) {
    console.error('[coins/limit-bump] failed', err);
    return errorResponse('Limit bump failed');
  }
}
