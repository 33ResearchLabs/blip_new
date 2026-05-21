/**
 * Streak + dispute-free detection.
 *
 * Runs daily. For each actor with recent activity:
 *   - Compute trailing consecutive-day trade streak (7-day, 30-day).
 *   - Compute dispute-free status for the just-ended calendar month.
 *
 * Both events are idempotent via source_ref (the ISO week / year-month
 * encodes uniqueness), so re-runs are no-ops.
 *
 * Scale-safe: queries are per-actor against an indexed
 * (entity, completed_at) range. We process the actor list in batches
 * to keep memory bounded.
 */

import { query } from '@/lib/db';
import { awardStreak, awardDisputeFreeMonth } from './awards';
import type { WaitlistActorType } from '@/lib/types/database';

const BATCH_SIZE = 500;

/**
 * Build the list of actors with completed trades in the last 30 days
 * — those are the only candidates for streak/dispute-free credits.
 */
async function getActiveActors(): Promise<{ actorId: string; actorType: WaitlistActorType }[]> {
  const merchantRows = await query<{ id: string }>(
    `SELECT DISTINCT m_id AS id FROM (
        SELECT merchant_id AS m_id FROM orders
         WHERE merchant_id IS NOT NULL
           AND status = 'completed'
           AND completed_at >= NOW() - INTERVAL '30 days'
        UNION
        SELECT buyer_merchant_id FROM orders
         WHERE buyer_merchant_id IS NOT NULL
           AND status = 'completed'
           AND completed_at >= NOW() - INTERVAL '30 days'
     ) m`,
  );
  const userRows = await query<{ id: string }>(
    `SELECT DISTINCT user_id AS id FROM orders
      WHERE user_id IS NOT NULL
        AND status = 'completed'
        AND completed_at >= NOW() - INTERVAL '30 days'`,
  );

  return [
    ...merchantRows.map((r) => ({ actorId: r.id, actorType: 'merchant' as const })),
    ...userRows.map((r) => ({ actorId: r.id, actorType: 'user' as const })),
  ];
}

/**
 * Returns the longest trailing consecutive-day streak ending TODAY (UTC),
 * counting only days with at least one completed trade.
 */
async function computeTrailingStreak(
  actorId: string,
  actorType: WaitlistActorType,
): Promise<number> {
  const actorCol = actorType === 'merchant' ? 'merchant_id' : 'user_id';
  // Pull last 35 days of trade-dates so we can detect both 7- and
  // 30-day streaks in one query.
  const rows = await query<{ trade_day: string }>(
    `SELECT DISTINCT DATE(completed_at AT TIME ZONE 'UTC') AS trade_day
       FROM orders
      WHERE ${actorCol} = $1
        AND status = 'completed'
        AND completed_at >= NOW() - INTERVAL '35 days'
   ORDER BY trade_day DESC`,
    [actorId],
  );
  if (rows.length === 0) return 0;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  let streak = 0;
  const expected = new Date(today);
  for (const r of rows) {
    const day = new Date(r.trade_day + 'T00:00:00Z');
    if (day.getTime() === expected.getTime()) {
      streak += 1;
      expected.setUTCDate(expected.getUTCDate() - 1);
    } else if (day < expected) {
      // gap — streak broken
      break;
    }
    // if day > expected (future-dated, shouldn't happen) skip
  }
  return streak;
}

/**
 * ISO week key: '2026-W21'. Used as the streak idempotency anchor so a
 * 7-day streak can only earn once per week.
 */
function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function lastMonthKey(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Was this actor dispute-free for the entirety of the just-ended month?
 * (i.e. no disputes filed against them during that month).
 */
async function wasDisputeFreeLastMonth(
  actorId: string,
  actorType: WaitlistActorType,
): Promise<boolean> {
  // Filter on disputes where this actor was the *target* (other party
  // raised against them) — being the raiser doesn't disqualify.
  const oppositeRaiser = actorType === 'merchant' ? 'user' : 'merchant';
  const actorCol = actorType === 'merchant' ? 'merchant_id' : 'user_id';

  const result = await query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt
       FROM disputes d
       JOIN orders o ON o.id = d.order_id
      WHERE o.${actorCol} = $1
        AND d.raised_by = $2
        AND d.created_at >= date_trunc('month', NOW() - INTERVAL '1 month')
        AND d.created_at <  date_trunc('month', NOW())`,
    [actorId, oppositeRaiser],
  );
  return (result[0]?.cnt ?? 0) === 0;
}

export interface StreakWorkerStats {
  actorsProcessed: number;
  streak7Credited: number;
  streak30Credited: number;
  disputeFreeCredited: number;
}

/**
 * Run a single pass — call daily from a cron-style entrypoint.
 * The reputation worker already runs daily; this fits beside it.
 */
export async function runStreakWorker(): Promise<StreakWorkerStats> {
  const actors = await getActiveActors();
  const stats: StreakWorkerStats = {
    actorsProcessed: 0,
    streak7Credited: 0,
    streak30Credited: 0,
    disputeFreeCredited: 0,
  };

  // Process in chunks to keep heap bounded under 100M users at peak.
  for (let i = 0; i < actors.length; i += BATCH_SIZE) {
    const chunk = actors.slice(i, i + BATCH_SIZE);
    await Promise.all(
      chunk.map(async (a) => {
        stats.actorsProcessed += 1;

        // Streaks: 7-day fires every full week; 30-day fires once a month.
        const streak = await computeTrailingStreak(a.actorId, a.actorType);
        if (streak >= 7) {
          const r = await awardStreak({
            actorId: a.actorId,
            actorType: a.actorType,
            kind: 7,
            weekKey: isoWeekKey(new Date()),
          });
          if (r.credited > 0) stats.streak7Credited += 1;
        }
        if (streak >= 30) {
          const monthKey = lastMonthKey();
          const r = await awardStreak({
            actorId: a.actorId,
            actorType: a.actorType,
            kind: 30,
            weekKey: monthKey,
          });
          if (r.credited > 0) stats.streak30Credited += 1;
        }

        // Dispute-free month — only fire on the first day of a new month.
        const todayIsMonthStart = new Date().getUTCDate() === 1;
        if (todayIsMonthStart) {
          const clean = await wasDisputeFreeLastMonth(a.actorId, a.actorType);
          if (clean) {
            const r = await awardDisputeFreeMonth({
              actorId: a.actorId,
              actorType: a.actorType,
              yearMonth: lastMonthKey(),
            });
            if (r.credited > 0) stats.disputeFreeCredited += 1;
          }
        }
      }),
    );
  }

  return stats;
}
