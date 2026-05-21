/**
 * In-app coin economy — orchestration over the raw creditPoints ledger.
 *
 * What this module owns:
 *   - Hard cap (HARD_CAP_COINS — balance can never reach 100k)
 *   - Soft taper (earn multiplier decays as balance climbs)
 *   - Per-event-type daily / monthly / lifetime caps via blip_coin_caps_state
 *   - Locked balances via blip_coin_locks (signup bonus, referral holds,
 *     time-based unvested bonuses)
 *   - Debits (burns) with non-negative balance enforcement
 *
 * What this module does NOT own:
 *   - The waitlist airdrop (uses creditPoints directly — keep that path
 *     untouched, those events are one-shot and pre-date the taper).
 *   - Reputation (separate calculator; this module emits events the rep
 *     worker reads, but doesn't compute scores).
 *
 * Scale notes (100M users):
 *   - All paths denormalize to users.blip_points / merchants.blip_points
 *     so reads are O(1).
 *   - Caps state is keyed on (actor_id, event_type, period_kind, period_start).
 *     A daily prune isn't shipped yet — when the table grows past ~10M rows
 *     we add a TTL job. Until then, indexes on the partial "current period"
 *     keep reads fast.
 *   - Locked-balance unlock is lazy: we sweep eligible rows when an actor's
 *     balance is read or written. No scheduled job required.
 */

import { query, queryOne, transaction } from '@/lib/db';
import type {
  BlipPointEvent,
  WaitlistActorType,
} from '@/lib/types/database';

/** Absolute ceiling — total balance can never reach 100,000.
 *  Soft taper makes hitting even 90k take genuine sustained activity. */
export const HARD_CAP_COINS = 99_999;

/** Notional value used for spec docs only — keep in sync with product copy. */
export const COIN_NOTIONAL_USD = 0.01;

/** Soft-taper schedule. Multiplier applied to any incoming earn based on
 *  the actor's current TOTAL balance (locked + unlocked). Designed so:
 *    - 0 → 50k:   full earn rate
 *    - 50k → 80k: half
 *    - 80k → 95k: quarter
 *    - 95k+:      a tenth (asymptotic floor — never quite 100k)
 *
 *  Applied AFTER per-event caps. We don't apply it on debits or on locked
 *  releases (those already accounted for at the time of original credit). */
function softTaperMultiplier(currentBalance: number): number {
  if (currentBalance < 50_000) return 1.0;
  if (currentBalance < 80_000) return 0.5;
  if (currentBalance < 95_000) return 0.25;
  return 0.1;
}

/** Per-event cap policy. Caps are advisory (the function clamps), not
 *  validation errors. Callers can request `points` and we'll credit
 *  whatever fits within the window. */
export interface CapPolicy {
  /** Max grants of this event per (actor, period). Counts of TRIGGERS,
   *  not total points — protects against abusive trigger frequency. */
  perPeriodCount?: number;
  /** Max total points of this event per (actor, period). Protects
   *  against single-trigger inflation (e.g. one huge trade). */
  perPeriodAmount?: number;
  periodKind: 'day' | 'month' | 'lifetime';
}

/** Default cap policies. Keys are the event types managed by this module —
 *  waitlist events go through creditPoints directly and are not capped here. */
export const CAP_POLICIES: Partial<Record<BlipPointEvent, CapPolicy>> = {
  FIRST_TRADE:           { perPeriodCount: 1,   periodKind: 'lifetime' },
  TRADE_COMPLETED:       { perPeriodCount: 20,  perPeriodAmount: 100,  periodKind: 'day' },
  VOLUME_BONUS:          { perPeriodAmount: 500, periodKind: 'day' },
  STREAK_7:              { perPeriodCount: 4,   periodKind: 'month' },
  STREAK_30:             { perPeriodCount: 1,   periodKind: 'month' },
  DISPUTE_FREE_MONTH:    { perPeriodCount: 1,   periodKind: 'month' },
  FIVE_STAR_RECEIVED:    { perPeriodAmount: 100, periodKind: 'month' },
  REFERRAL_TRADE_CREDITED: { perPeriodCount: 50, periodKind: 'lifetime' },
  KYC_COMPLETED:         { perPeriodCount: 1,   periodKind: 'lifetime' },
};

interface AwardArgs {
  actorId: string;
  actorType: WaitlistActorType;
  event: BlipPointEvent;
  /** Requested points. Subject to caps + soft taper + hard ceiling. */
  points: number;
  /** Idempotency anchor — when set, the unique index on
   *  (actor, event, source_ref) blocks double-credit on retry/race.
   *  Required for trade-driven events (order_id), rating-driven
   *  events (rating_id), etc. */
  sourceRef?: string;
  /** Optional lock — if set, the credit lands in `locked_blip_points`
   *  and a `blip_coin_locks` row is created with this `unlocksAt`.
   *  Used for signup bonuses (anti-bot), unverified referrals, etc. */
  lockUntil?: Date;
  metadata?: Record<string, unknown>;
}

export interface AwardResult {
  credited: number;
  reason: 'OK' | 'CAPPED' | 'HARD_CAP' | 'ALREADY_CREDITED' | 'TAPERED_TO_ZERO';
  newBalance: number;
  logId: string | null;
}

/**
 * Award coins atomically — handles caps, taper, lock, hard ceiling.
 * Always returns; never throws on cap-related rejections (returns
 * credited: 0 with a reason instead).
 */
export async function awardCoins(args: AwardArgs): Promise<AwardResult> {
  const { actorId, actorType, event, points, sourceRef, lockUntil, metadata = {} } = args;
  if (points <= 0) {
    return { credited: 0, reason: 'TAPERED_TO_ZERO', newBalance: 0, logId: null };
  }

  const table = actorType === 'merchant' ? 'merchants' : 'users';
  const policy = CAP_POLICIES[event];

  return transaction(async (client) => {
    // ----- 1. Read current state (balance + lock) under row lock so the
    //          taper + cap math is consistent with the impending write.
    const balRes = await client.query<{ blip_points: number; locked_blip_points: number }>(
      `SELECT blip_points, locked_blip_points FROM ${table}
       WHERE id = $1 FOR UPDATE`,
      [actorId],
    );
    if (balRes.rows.length === 0) {
      return { credited: 0, reason: 'OK' as const, newBalance: 0, logId: null };
    }
    const currentBal = balRes.rows[0].blip_points ?? 0;
    const currentLocked = balRes.rows[0].locked_blip_points ?? 0;
    const totalHeld = currentBal + currentLocked;

    // ----- 2. Apply per-event cap window if a policy exists.
    let allowed = points;
    if (policy) {
      const periodStart = startOfPeriodUTC(policy.periodKind);
      const capRes = await client.query<{ count: number; amount: number }>(
        `SELECT count, amount FROM blip_coin_caps_state
         WHERE actor_type = $1 AND actor_id = $2 AND event_type = $3
           AND period_kind = $4 AND period_start = $5
         FOR UPDATE`,
        [actorType, actorId, event, policy.periodKind, periodStart],
      );
      const existing = capRes.rows[0] ?? { count: 0, amount: 0 };

      if (policy.perPeriodCount != null && existing.count >= policy.perPeriodCount) {
        return { credited: 0, reason: 'CAPPED' as const, newBalance: currentBal, logId: null };
      }
      if (policy.perPeriodAmount != null) {
        const remaining = policy.perPeriodAmount - existing.amount;
        if (remaining <= 0) {
          return { credited: 0, reason: 'CAPPED' as const, newBalance: currentBal, logId: null };
        }
        allowed = Math.min(allowed, remaining);
      }
    }

    // ----- 3. Apply soft taper based on current total held.
    const tapered = Math.floor(allowed * softTaperMultiplier(totalHeld));
    if (tapered <= 0) {
      return { credited: 0, reason: 'TAPERED_TO_ZERO' as const, newBalance: currentBal, logId: null };
    }

    // ----- 4. Hard ceiling — can never exceed HARD_CAP_COINS total.
    const headroom = HARD_CAP_COINS - totalHeld;
    if (headroom <= 0) {
      return { credited: 0, reason: 'HARD_CAP' as const, newBalance: currentBal, logId: null };
    }
    const finalAmount = Math.min(tapered, headroom);

    // ----- 5. Write the ledger row. Note: we don't use the
    //          REGISTER/MERCHANT_REGISTER unique-index path; trade events
    //          are repeatable by design.
    // Idempotent write — the partial unique index on
    // (actor_type, actor_id, event, source_ref) for trade-bound events
    // means a retry returns 0 rows instead of double-crediting.
    const logRes = await client.query<{ id: string }>(
      `INSERT INTO blip_point_log (actor_id, actor_type, event, bonus_points, source_ref, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [actorId, actorType, event, finalAmount, sourceRef ?? null, metadata],
    );
    if (logRes.rows.length === 0) {
      return { credited: 0, reason: 'ALREADY_CREDITED' as const, newBalance: currentBal, logId: null };
    }
    const logId = logRes.rows[0].id;

    // ----- 6. Update denormalized counter. Locked credits go to the
    //          locked column; otherwise to the regular balance.
    let newBalance: number;
    let newLocked: number;
    if (lockUntil) {
      const lockedRes = await client.query<{ locked_blip_points: number }>(
        `UPDATE ${table}
         SET locked_blip_points = COALESCE(locked_blip_points, 0) + $1,
             updated_at = NOW()
         WHERE id = $2
         RETURNING locked_blip_points`,
        [finalAmount, actorId],
      );
      newBalance = currentBal;
      newLocked = lockedRes.rows[0].locked_blip_points;

      await client.query(
        `INSERT INTO blip_coin_locks (actor_id, actor_type, amount, source_event, source_ref, unlocks_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [actorId, actorType, finalAmount, event, logId, lockUntil],
      );
    } else {
      const bumpRes = await client.query<{ blip_points: number }>(
        `UPDATE ${table}
         SET blip_points = COALESCE(blip_points, 0) + $1,
             updated_at = NOW()
         WHERE id = $2
         RETURNING blip_points`,
        [finalAmount, actorId],
      );
      newBalance = bumpRes.rows[0].blip_points;
      newLocked = currentLocked;
    }

    // ----- 7. Snapshot running total on the log row.
    await client.query(
      `UPDATE blip_point_log SET total_points = $1 WHERE id = $2`,
      [newBalance + newLocked, logId],
    );

    // ----- 8. Bump the cap-window state row (upsert).
    if (policy) {
      const periodStart = startOfPeriodUTC(policy.periodKind);
      await client.query(
        `INSERT INTO blip_coin_caps_state
           (actor_type, actor_id, event_type, period_kind, period_start, count, amount, updated_at)
         VALUES ($1, $2, $3, $4, $5, 1, $6, NOW())
         ON CONFLICT (actor_type, actor_id, event_type, period_kind, period_start)
         DO UPDATE SET count = blip_coin_caps_state.count + 1,
                       amount = blip_coin_caps_state.amount + EXCLUDED.amount,
                       updated_at = NOW()`,
        [actorType, actorId, event, policy.periodKind, periodStart, finalAmount],
      );
    }

    return {
      credited: finalAmount,
      reason: 'OK' as const,
      newBalance,
      logId,
    };
  });
}

interface DebitArgs {
  actorId: string;
  actorType: WaitlistActorType;
  event: 'LIMIT_BUMP_BURN' | 'PERK_BURN' | 'MANUAL_DEBIT';
  points: number;
  metadata?: Record<string, unknown>;
}

export interface DebitResult {
  debited: number;
  reason: 'OK' | 'INSUFFICIENT_BALANCE';
  newBalance: number;
  logId: string | null;
}

/**
 * Burn coins from the unlocked balance. Locked coins are NOT spendable —
 * that's by design (signup holds, unverified referrals, etc. need to
 * complete their unlock window before they can be spent).
 *
 * Atomic + non-negative-balance guarded. Returns INSUFFICIENT_BALANCE
 * without erroring when the actor doesn't have the coins.
 */
export async function burnCoins(args: DebitArgs): Promise<DebitResult> {
  const { actorId, actorType, event, points, metadata = {} } = args;
  if (points <= 0) {
    return { debited: 0, reason: 'OK', newBalance: 0, logId: null };
  }
  const table = actorType === 'merchant' ? 'merchants' : 'users';

  return transaction(async (client) => {
    // Conditional UPDATE: only succeeds if blip_points >= points.
    const updRes = await client.query<{ blip_points: number }>(
      `UPDATE ${table}
       SET blip_points = blip_points - $1, updated_at = NOW()
       WHERE id = $2 AND blip_points >= $1
       RETURNING blip_points`,
      [points, actorId],
    );
    if (updRes.rows.length === 0) {
      const curRes = await client.query<{ blip_points: number }>(
        `SELECT blip_points FROM ${table} WHERE id = $1`,
        [actorId],
      );
      return {
        debited: 0,
        reason: 'INSUFFICIENT_BALANCE' as const,
        newBalance: curRes.rows[0]?.blip_points ?? 0,
        logId: null,
      };
    }

    const logRes = await client.query<{ id: string }>(
      `INSERT INTO blip_point_log (actor_id, actor_type, event, bonus_points, total_points, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [actorId, actorType, event, -points, updRes.rows[0].blip_points, metadata],
    );

    return {
      debited: points,
      reason: 'OK' as const,
      newBalance: updRes.rows[0].blip_points,
      logId: logRes.rows[0].id,
    };
  });
}

/**
 * Sweep this actor's eligible coin locks — move locked → spendable for
 * any `unlocks_at <= now` rows that haven't been released or voided yet.
 *
 * Lazy: called from getCoinBalance and from any awardCoins/burnCoins
 * path so the user always sees the most current state on the next
 * interaction. Safe to call repeatedly — already-released rows are
 * filtered out.
 */
export async function sweepEligibleUnlocks(
  actorId: string,
  actorType: WaitlistActorType,
): Promise<{ unlocked: number }> {
  const table = actorType === 'merchant' ? 'merchants' : 'users';

  return transaction(async (client) => {
    const dueRes = await client.query<{ id: string; amount: number }>(
      `SELECT id, amount FROM blip_coin_locks
       WHERE actor_type = $1 AND actor_id = $2
         AND released_at IS NULL AND voided_at IS NULL
         AND unlocks_at <= NOW()
       FOR UPDATE`,
      [actorType, actorId],
    );
    if (dueRes.rows.length === 0) {
      return { unlocked: 0 };
    }
    const total = dueRes.rows.reduce((acc, r) => acc + r.amount, 0);

    await client.query(
      `UPDATE blip_coin_locks
       SET released_at = NOW()
       WHERE id = ANY($1::uuid[])`,
      [dueRes.rows.map((r) => r.id)],
    );

    await client.query(
      `UPDATE ${table}
       SET blip_points = COALESCE(blip_points, 0) + $1,
           locked_blip_points = GREATEST(COALESCE(locked_blip_points, 0) - $1, 0),
           updated_at = NOW()
       WHERE id = $2`,
      [total, actorId],
    );

    // Audit row so history shows the unlock as a discrete event.
    await client.query(
      `INSERT INTO blip_point_log (actor_id, actor_type, event, bonus_points, metadata)
       VALUES ($1, $2, 'COIN_UNLOCK', $3, $4)`,
      [actorId, actorType, total, { lockIds: dueRes.rows.map((r) => r.id) }],
    );

    return { unlocked: total };
  });
}

export interface CoinBalanceSnapshot {
  balance: number;
  locked: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  headroomToHardCap: number;
}

/**
 * Read current balance + lifetime stats. Sweeps eligible unlocks first
 * so the caller never sees stale locked coins that should already be
 * spendable.
 */
export async function getCoinBalance(
  actorId: string,
  actorType: WaitlistActorType,
): Promise<CoinBalanceSnapshot> {
  await sweepEligibleUnlocks(actorId, actorType);

  const table = actorType === 'merchant' ? 'merchants' : 'users';
  const row = await queryOne<{ blip_points: number; locked_blip_points: number }>(
    `SELECT blip_points, locked_blip_points FROM ${table} WHERE id = $1`,
    [actorId],
  );
  const balance = row?.blip_points ?? 0;
  const locked = row?.locked_blip_points ?? 0;

  // Lifetime aggregates — derived from the ledger, cached at read time.
  // For 100M-user scale we'll move these to a materialized view; for now
  // a single indexed aggregate per request is fine.
  const agg = await queryOne<{ earned: number; spent: number }>(
    `SELECT
        COALESCE(SUM(CASE WHEN bonus_points > 0 THEN bonus_points ELSE 0 END), 0) AS earned,
        COALESCE(SUM(CASE WHEN bonus_points < 0 THEN -bonus_points ELSE 0 END), 0) AS spent
       FROM blip_point_log
      WHERE actor_type = $1 AND actor_id = $2`,
    [actorType, actorId],
  );

  return {
    balance,
    locked,
    lifetimeEarned: agg?.earned ?? 0,
    lifetimeSpent: agg?.spent ?? 0,
    headroomToHardCap: Math.max(HARD_CAP_COINS - (balance + locked), 0),
  };
}

/** UTC date that a given period bucket starts on. Lifetime caps share
 *  a single "epoch" bucket (1970-01-01) so the cap-state lookup is the
 *  same shape regardless of period_kind. */
function startOfPeriodUTC(kind: 'day' | 'month' | 'lifetime'): string {
  const now = new Date();
  if (kind === 'lifetime') return '1970-01-01';
  if (kind === 'month') {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }
  // day
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${now.getUTCFullYear()}-${m}-${d}`;
}
