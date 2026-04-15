/**
 * Reputation Worker (Core API)
 *
 * Periodically recalculates all merchant and user reputations.
 * Writes results to:
 *   - merchants.reputation_score, merchants.reputation_tier
 *   - users.reputation_score, users.reputation_tier
 *   - reputation_scores (full breakdown)
 */

import { query as dbQuery, logger } from 'settlement-core';
import { calculateMerchantReputation, calculateUserReputation } from '../reputation/calculate';

const POLL_INTERVAL_MS = parseInt(process.env.REPUTATION_RECALC_INTERVAL_MS || '300000', 10); // 5 minutes default
// Reduced parallelism to prevent connection-pool spikes.
// Each calculateXxxReputation fires 3 DB writes (upsert score + history + fast-access update),
// so BATCH_SIZE=3 × 3 writes = 9 concurrent DB ops per batch, well within safe limits.
const BATCH_SIZE = 3;
const BATCH_DELAY_MS = 1000;
// Only recompute reputation for entities that had activity recently.
// Inactive merchants/users don't need constant recalculation.
const ACTIVITY_WINDOW_HOURS = parseInt(process.env.REPUTATION_ACTIVITY_WINDOW_HOURS || '24', 10);

let pollTimer: NodeJS.Timeout | null = null;
let isRunning = false;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function recalculateAll(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  try {
    // Only recompute for merchants with recent activity (completed orders or updates).
    // Reputations for inactive merchants don't change — no need to hammer the DB.
    // NOTE: DISTINCT is not needed here because the WHERE clause uses EXISTS
    // (not JOIN) so rows can't duplicate. This also avoids the 42P10 error
    // "for SELECT DISTINCT, ORDER BY expressions must appear in select list".
    const merchants = await dbQuery<{ id: string; wallet_address: string }>(
      `SELECT m.id, m.wallet_address FROM merchants m
       WHERE m.updated_at > NOW() - ($1 || ' hours')::interval
          OR EXISTS (
            SELECT 1 FROM orders o
            WHERE (o.merchant_id = m.id OR o.buyer_merchant_id = m.id)
              AND (o.completed_at > NOW() - ($1 || ' hours')::interval
                OR o.cancelled_at > NOW() - ($1 || ' hours')::interval
                OR o.created_at > NOW() - ($1 || ' hours')::interval)
          )
       ORDER BY m.updated_at DESC`,
      [ACTIVITY_WINDOW_HOURS.toString()]
    );

    for (let i = 0; i < merchants.length; i += BATCH_SIZE) {
      const batch = merchants.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(m => calculateMerchantReputation(m.wallet_address || m.id).catch(err => {
          logger.error(`Reputation calc failed for merchant ${m.id}: ${err.message}`);
        }))
      );
      if (i + BATCH_SIZE < merchants.length) await sleep(BATCH_DELAY_MS);
    }

    // Only recompute for users who had order activity in the window.
    const users = await dbQuery<{ id: string; wallet_address: string }>(
      `SELECT DISTINCT u.id, u.wallet_address FROM users u
       INNER JOIN orders o ON o.user_id = u.id
       WHERE o.completed_at > NOW() - ($1 || ' hours')::interval
          OR o.cancelled_at > NOW() - ($1 || ' hours')::interval
          OR o.created_at > NOW() - ($1 || ' hours')::interval`,
      [ACTIVITY_WINDOW_HOURS.toString()]
    );

    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(u => calculateUserReputation(u.wallet_address || u.id).catch(err => {
          logger.error(`Reputation calc failed for user ${u.id}: ${err.message}`);
        }))
      );
      if (i + BATCH_SIZE < users.length) await sleep(BATCH_DELAY_MS);
    }

    logger.info(`[reputation] Recalculated ${merchants.length} merchants, ${users.length} users`);
  } catch (err: any) {
    logger.error(`[reputation] Batch recalculation failed: ${err.message}`);
  } finally {
    isRunning = false;
  }
}

export function startReputationWorker(): void {
  // Run once on startup after a short delay
  setTimeout(() => recalculateAll(), 10000);

  // Then run periodically
  pollTimer = setInterval(() => recalculateAll(), POLL_INTERVAL_MS);
  logger.info(`[reputation] Worker started, interval=${POLL_INTERVAL_MS}ms`);
}

export function stopReputationWorker(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
