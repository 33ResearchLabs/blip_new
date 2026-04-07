/**
 * Daily Reputation Score Worker
 *
 * Runs once per day (default: every 24 hours).
 * Recalculates reputation scores for ALL active merchants and users.
 *
 * Reputation events are recorded in real-time (on every trade, review, dispute).
 * This worker batch-processes those events into final scores, tiers, and badges.
 *
 * Run: npx tsx src/workers/reputation-worker.ts
 */

import { query } from '@/lib/db';
import { updateReputationScore } from '@/lib/reputation/repository';
import { logger } from '@/lib/logger';

const WORKER_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function recalculateAllScores(): Promise<void> {
  try {
    console.log('[ReputationWorker] Starting daily reputation recalculation...');

    // Get all active merchants
    const merchants = await query<{ id: string; username: string }>(
      `SELECT id, username FROM merchants WHERE status = 'active'`
    );

    // Get all users with at least 1 completed trade
    const users = await query<{ id: string; username: string }>(
      `SELECT DISTINCT u.id, u.username FROM users u
       WHERE EXISTS (
         SELECT 1 FROM orders o
         WHERE (o.user_id = u.id)
           AND o.status = 'completed'
       )`
    );

    let merchantUpdated = 0;
    let userUpdated = 0;
    let errors = 0;

    // Update merchant scores
    for (const merchant of merchants) {
      try {
        await updateReputationScore(merchant.id, 'merchant');
        merchantUpdated++;
      } catch (err) {
        errors++;
        logger.error('[ReputationWorker] Failed to update merchant score', {
          merchantId: merchant.id,
          username: merchant.username,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Update user scores
    for (const user of users) {
      try {
        await updateReputationScore(user.id, 'user');
        userUpdated++;
      } catch (err) {
        errors++;
        logger.error('[ReputationWorker] Failed to update user score', {
          userId: user.id,
          username: user.username,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    console.log('[ReputationWorker] Daily recalculation complete', {
      merchants: `${merchantUpdated}/${merchants.length}`,
      users: `${userUpdated}/${users.length}`,
      errors,
    });
  } catch (error) {
    logger.error('[ReputationWorker] Worker error', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function start() {
  console.log('[ReputationWorker] Worker started');
  console.log(`[ReputationWorker] Recalculating every ${WORKER_INTERVAL_MS / 1000 / 60 / 60} hours`);

  // Initial run
  await recalculateAllScores();

  // Schedule daily runs
  setInterval(recalculateAllScores, WORKER_INTERVAL_MS);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('[ReputationWorker] Worker shutting down');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[ReputationWorker] Worker shutting down');
  process.exit(0);
});

// Start worker if run directly
if (require.main === module) {
  start().catch((error) => {
    console.error('[ReputationWorker] Failed to start worker:', error);
    process.exit(1);
  });
}

export { start, recalculateAllScores };
