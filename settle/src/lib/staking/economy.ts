/**
 * USDT staking economy — principal, lazy reward accrual, and the staking →
 * trading-limit floor. Backs the "Stake USDT" screen (see StakeUSDTView) and the
 * /api/staking/* routes.
 *
 * Money model: staked principal is moved out of users/merchants.balance (real
 * USDT, DECIMAL(20,8)) into staking_positions.principal. Rewards accrue
 * continuously at apy_bps and are computed on read; they are MATERIALIZED into
 * accrued_rewards (with last_accrued_at advanced) on every mutation, so no cron
 * is needed. Claiming moves accrued_rewards back into the spendable balance.
 *
 * All mutations run in a single transaction() with SELECT … FOR UPDATE on the
 * actor balance row and the position row, and rely on the non-negative CHECK
 * constraints (balance, principal, accrued_rewards) as the final guard.
 */

import { transaction, queryOne } from '@/lib/db';
import type { PoolClient } from 'pg';
import type { WaitlistActorType } from '@/lib/types/database';

/** 800 bps = 8.00% APY (mockup default). Single source of truth. */
export const STAKE_APY_BPS = 800;
export const SECONDS_PER_YEAR = 365 * 24 * 60 * 60; // 31_536_000

/**
 * Staked-USDT → trading-limit MULTIPLIER (Stake-Based Limit Boost spec).
 * Staking multiplies the actor's base daily/per-trade limit — it does NOT set an
 * absolute USD floor and does NOT change Trust/reputation. The highest tier whose
 * threshold the principal meets wins; below 100 USDT there is no boost (1x).
 * Active for as long as the principal stays at/above the threshold (no expiry,
 * unlike coin unlocks). Final limit = base limit × multiplier.
 *
 *   >= 2,500 USDT → 50x      >= 1,000 → 20x      >= 500 → 10x
 *   >=   250 USDT →  5x      >=   100 →  3x      <  100 →  1x (no boost)
 */
export const STAKE_LIMIT_TIERS = [
  { minStakeUsd: 2_500, multiplier: 50, tier: 'S5' },
  { minStakeUsd: 1_000, multiplier: 20, tier: 'S4' },
  { minStakeUsd: 500,   multiplier: 10, tier: 'S3' },
  { minStakeUsd: 250,   multiplier: 5,  tier: 'S2' },
  { minStakeUsd: 100,   multiplier: 3,  tier: 'S1' },
] as const;

const SECONDS_PER_DAY = 24 * 60 * 60;

/** Round to 8 dp (USDT precision) to avoid float drift before a DB write. */
function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

function tableFor(actorType: WaitlistActorType): 'users' | 'merchants' {
  return actorType === 'merchant' ? 'merchants' : 'users';
}

interface PositionRow {
  id: string;
  principal: string;
  accrued_rewards: string;
  lifetime_rewards: string;
  apy_bps: number;
  last_accrued_at: Date;
}

/**
 * Continuously-accrued, not-yet-materialized rewards since `lastAccruedAt`.
 * Pure — used both for display (on read) and to materialize (on mutation).
 */
export function computePending(
  principal: number,
  apyBps: number,
  lastAccruedAt: Date | string,
  now: Date,
): number {
  if (principal <= 0 || apyBps <= 0) return 0;
  const last = new Date(lastAccruedAt).getTime();
  const elapsedSec = Math.max(0, (now.getTime() - last) / 1000);
  return round8((principal * (apyBps / 10_000) * elapsedSec) / SECONDS_PER_YEAR);
}

export interface StakingSnapshot {
  principal: number;
  /** accrued_rewards + live pending since last_accrued_at (display value). */
  pendingRewards: number;
  lifetimeRewards: number;
  apyBps: number;
  /** Spendable (un-staked) balance available to stake. */
  availableBalance: number;
  /** principal + pendingRewards. */
  totalValue: number;
  /** principal × APY for one day / 30 days (display estimates). */
  estDaily: number;
  estMonthly: number;
  lastAccruedAt: string | null;
}

/** Read-only snapshot for /api/staking/me — never writes. */
export async function getStakingSnapshot(
  accountType: WaitlistActorType,
  accountId: string,
): Promise<StakingSnapshot> {
  const [pos, acct] = await Promise.all([
    queryOne<PositionRow>(
      `SELECT id, principal, accrued_rewards, lifetime_rewards, apy_bps, last_accrued_at
         FROM staking_positions
        WHERE account_type = $1 AND account_id = $2`,
      [accountType, accountId],
    ),
    queryOne<{ balance: string }>(
      `SELECT balance FROM ${tableFor(accountType)} WHERE id = $1`,
      [accountId],
    ),
  ]);

  const principal = pos ? Number(pos.principal) : 0;
  const apyBps = pos ? pos.apy_bps : STAKE_APY_BPS;
  const accrued = pos ? Number(pos.accrued_rewards) : 0;
  const pending =
    pos ? accrued + computePending(principal, apyBps, pos.last_accrued_at, new Date()) : 0;
  const dailyRate = (apyBps / 10_000) * (SECONDS_PER_DAY / SECONDS_PER_YEAR);

  return {
    principal,
    pendingRewards: round8(pending),
    lifetimeRewards: pos ? Number(pos.lifetime_rewards) : 0,
    apyBps,
    availableBalance: acct ? Number(acct.balance) : 0,
    totalValue: round8(principal + pending),
    estDaily: round8(principal * dailyRate),
    estMonthly: round8(principal * dailyRate * 30),
    lastAccruedAt: pos ? new Date(pos.last_accrued_at).toISOString() : null,
  };
}

/**
 * Staking-derived limit MULTIPLIER for getEffectiveLimits. O(1) single read of
 * the principal; returns the multiplier of the highest tier the principal meets
 * (1 = no stake boost). `tier` is the label for display/source attribution.
 */
export async function getStakeMultiplier(
  accountType: WaitlistActorType,
  accountId: string,
): Promise<{ multiplier: number; tier: string | null; principal: number }> {
  const none = { multiplier: 1, tier: null, principal: 0 };
  // This runs inside getEffectiveLimits on EVERY order-create. If migration 165
  // hasn't landed in this environment yet, treat a missing table as "no staking
  // boost" rather than throwing and breaking the order-create / limits path.
  let pos: { principal: string } | null = null;
  try {
    pos = await queryOne<{ principal: string }>(
      `SELECT principal FROM staking_positions
        WHERE account_type = $1 AND account_id = $2`,
      [accountType, accountId],
    );
  } catch (err) {
    console.error('[staking] getStakeMultiplier fallback (table missing?)', err);
    return none;
  }
  const principal = pos ? Number(pos.principal) : 0;
  for (const t of STAKE_LIMIT_TIERS) {
    if (principal >= t.minStakeUsd) {
      return { multiplier: t.multiplier, tier: t.tier, principal };
    }
  }
  return { ...none, principal };
}

/** Ensure a position row exists and lock it FOR UPDATE; returns the locked row. */
async function lockPosition(
  client: PoolClient,
  accountType: WaitlistActorType,
  accountId: string,
): Promise<PositionRow> {
  await client.query(
    `INSERT INTO staking_positions (account_type, account_id, apy_bps)
     VALUES ($1, $2, $3)
     ON CONFLICT (account_type, account_id) DO NOTHING`,
    [accountType, accountId, STAKE_APY_BPS],
  );
  const res = await client.query<PositionRow>(
    `SELECT id, principal, accrued_rewards, lifetime_rewards, apy_bps, last_accrued_at
       FROM staking_positions
      WHERE account_type = $1 AND account_id = $2
      FOR UPDATE`,
    [accountType, accountId],
  );
  return res.rows[0];
}

/**
 * Materialize accrued rewards into the row (accrued += pending, advance
 * last_accrued_at). Returns the post-accrual principal/accrued for callers.
 */
async function materializeAccrual(
  client: PoolClient,
  pos: PositionRow,
  now: Date,
): Promise<{ principal: number; accrued: number }> {
  const principal = Number(pos.principal);
  const pending = computePending(principal, pos.apy_bps, pos.last_accrued_at, now);
  const accrued = round8(Number(pos.accrued_rewards) + pending);
  await client.query(
    `UPDATE staking_positions
        SET accrued_rewards = $1, last_accrued_at = $2, updated_at = NOW()
      WHERE id = $3`,
    [accrued, now, pos.id],
  );
  return { principal, accrued };
}

async function logLedger(
  client: PoolClient,
  accountType: WaitlistActorType,
  accountId: string,
  entryType: 'STAKE' | 'UNSTAKE' | 'STAKE_REWARD',
  signedAmount: number,
  balanceBefore: number,
  balanceAfter: number,
  description: string,
): Promise<void> {
  await client.query(
    `INSERT INTO ledger_entries
       (account_type, account_id, entry_type, amount, asset, description,
        balance_before, balance_after)
     VALUES ($1, $2, $3, $4, 'USDT', $5, $6, $7)`,
    [accountType, accountId, entryType, signedAmount, description, balanceBefore, balanceAfter],
  );
}

async function logEvent(
  client: PoolClient,
  accountType: WaitlistActorType,
  accountId: string,
  eventType: 'STAKE' | 'UNSTAKE' | 'CLAIM',
  amount: number,
  principalAfter: number,
  rewardsAfter: number,
): Promise<void> {
  await client.query(
    `INSERT INTO staking_events
       (account_type, account_id, event_type, amount, principal_after, rewards_after)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [accountType, accountId, eventType, amount, principalAfter, rewardsAfter],
  );
}

export class StakingError extends Error {
  constructor(public code: 'INSUFFICIENT_BALANCE' | 'INSUFFICIENT_STAKE' | 'NOTHING_TO_CLAIM') {
    super(code);
    this.name = 'StakingError';
  }
}

export interface StakeResult {
  principal: number;
  accruedRewards: number;
  availableBalance: number;
}

/** Stake `amount` USDT: balance −amount, principal +amount. */
export async function stake(
  accountType: WaitlistActorType,
  accountId: string,
  amount: number,
): Promise<StakeResult> {
  const amt = round8(amount);
  const table = tableFor(accountType);
  return transaction(async (client) => {
    const balRes = await client.query<{ balance: string }>(
      `SELECT balance FROM ${table} WHERE id = $1 FOR UPDATE`,
      [accountId],
    );
    const balanceBefore = Number(balRes.rows[0]?.balance ?? 0);
    if (balanceBefore < amt) throw new StakingError('INSUFFICIENT_BALANCE');

    const pos = await lockPosition(client, accountType, accountId);
    const { accrued } = await materializeAccrual(client, pos, new Date());

    const updBal = await client.query<{ balance: string }>(
      `UPDATE ${table} SET balance = balance - $1 WHERE id = $2 RETURNING balance`,
      [amt, accountId],
    );
    const balanceAfter = Number(updBal.rows[0].balance);

    const updPos = await client.query<{ principal: string }>(
      `UPDATE staking_positions SET principal = principal + $1, updated_at = NOW()
        WHERE id = $2 RETURNING principal`,
      [amt, pos.id],
    );
    const principalAfter = Number(updPos.rows[0].principal);

    await logLedger(client, accountType, accountId, 'STAKE', -amt, balanceBefore, balanceAfter, 'Staked USDT');
    await logEvent(client, accountType, accountId, 'STAKE', amt, principalAfter, accrued);

    return { principal: principalAfter, accruedRewards: accrued, availableBalance: balanceAfter };
  });
}

/** Unstake `amount` USDT: principal −amount, balance +amount. */
export async function unstake(
  accountType: WaitlistActorType,
  accountId: string,
  amount: number,
): Promise<StakeResult> {
  const amt = round8(amount);
  const table = tableFor(accountType);
  return transaction(async (client) => {
    // Lock balance row first to keep a consistent lock order with stake().
    const balRes = await client.query<{ balance: string }>(
      `SELECT balance FROM ${table} WHERE id = $1 FOR UPDATE`,
      [accountId],
    );
    const balanceBefore = Number(balRes.rows[0]?.balance ?? 0);

    const pos = await lockPosition(client, accountType, accountId);
    const { accrued } = await materializeAccrual(client, pos, new Date());
    if (Number(pos.principal) < amt) throw new StakingError('INSUFFICIENT_STAKE');

    const updPos = await client.query<{ principal: string }>(
      `UPDATE staking_positions SET principal = principal - $1, updated_at = NOW()
        WHERE id = $2 RETURNING principal`,
      [amt, pos.id],
    );
    const principalAfter = Number(updPos.rows[0].principal);

    const updBal = await client.query<{ balance: string }>(
      `UPDATE ${table} SET balance = balance + $1 WHERE id = $2 RETURNING balance`,
      [amt, accountId],
    );
    const balanceAfter = Number(updBal.rows[0].balance);

    await logLedger(client, accountType, accountId, 'UNSTAKE', amt, balanceBefore, balanceAfter, 'Unstaked USDT');
    await logEvent(client, accountType, accountId, 'UNSTAKE', amt, principalAfter, accrued);

    return { principal: principalAfter, accruedRewards: accrued, availableBalance: balanceAfter };
  });
}

export interface ClaimResult extends StakeResult {
  claimed: number;
}

/** Claim accrued rewards into the spendable balance. */
export async function claim(
  accountType: WaitlistActorType,
  accountId: string,
): Promise<ClaimResult> {
  const table = tableFor(accountType);
  return transaction(async (client) => {
    const balRes = await client.query<{ balance: string }>(
      `SELECT balance FROM ${table} WHERE id = $1 FOR UPDATE`,
      [accountId],
    );
    const balanceBefore = Number(balRes.rows[0]?.balance ?? 0);

    const pos = await lockPosition(client, accountType, accountId);
    const { principal, accrued } = await materializeAccrual(client, pos, new Date());
    if (accrued <= 0) throw new StakingError('NOTHING_TO_CLAIM');

    const updBal = await client.query<{ balance: string }>(
      `UPDATE ${table} SET balance = balance + $1 WHERE id = $2 RETURNING balance`,
      [accrued, accountId],
    );
    const balanceAfter = Number(updBal.rows[0].balance);

    await client.query(
      `UPDATE staking_positions
          SET accrued_rewards = 0,
              lifetime_rewards = lifetime_rewards + $1,
              updated_at = NOW()
        WHERE id = $2`,
      [accrued, pos.id],
    );

    await logLedger(client, accountType, accountId, 'STAKE_REWARD', accrued, balanceBefore, balanceAfter, 'Claimed staking rewards');
    await logEvent(client, accountType, accountId, 'CLAIM', accrued, principal, 0);

    return { claimed: accrued, principal, accruedRewards: 0, availableBalance: balanceAfter };
  });
}

export interface StakingEventRow {
  id: string;
  event_type: 'STAKE' | 'UNSTAKE' | 'CLAIM';
  amount: string;
  principal_after: string | null;
  rewards_after: string | null;
  created_at: string;
}

/** Count of active stakers, for the "Staked users N+" badge. */
export async function getActiveStakerCount(): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM staking_positions WHERE principal > 0`,
  );
  return Number(row?.n ?? 0);
}
