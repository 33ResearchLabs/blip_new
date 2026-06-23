/**
 * GET /api/staking/me
 *
 * USDT staking snapshot for the current actor (user/merchant): staked principal,
 * pending/lifetime rewards, APY, spendable balance, total value, daily/monthly
 * estimates, plus the active-staker count for the "Staked users N+" badge.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, successResponse, forbiddenResponse } from '@/lib/middleware/auth';
import { getStakingSnapshot, getActiveStakerCount } from '@/lib/staking/economy';
import { queryOne } from '@/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
    return forbiddenResponse('Staking only applies to user/merchant accounts');
  }

  const [snapshot, stakedUsers, walletRow] = await Promise.all([
    getStakingSnapshot(auth.actorType, auth.actorId),
    getActiveStakerCount(),
    // The wallet that staked — persists in the profile even if the wallet is
    // disconnected, and is the one required to unstake (Rules 3 & 4).
    queryOne<{ staking_wallet_address: string | null }>(
      `SELECT staking_wallet_address FROM staking_positions
        WHERE account_type = $1 AND account_id = $2`,
      [auth.actorType, auth.actorId],
    ),
  ]);

  return successResponse({
    ...snapshot,
    stakedUsers,
    stakingWallet: walletRow?.staking_wallet_address ?? null,
  });
}
