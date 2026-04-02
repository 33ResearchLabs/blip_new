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
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 200;

let pollTimer: NodeJS.Timeout | null = null;
let isRunning = false;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function recalculateAll(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  try {
    // Merchants
    const merchants = await dbQuery<{ id: string; wallet_address: string }>(
      `SELECT id, wallet_address FROM merchants ORDER BY updated_at DESC`
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

    // Users with orders
    const users = await dbQuery<{ id: string; wallet_address: string }>(
      `SELECT DISTINCT u.id, u.wallet_address FROM users u
       INNER JOIN orders o ON o.user_id = u.id`
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
