/**
 * Reputation Score Worker (settle)
 *
 * Settle is the SOLE writer of the DISPLAY tables `reputation_scores` /
 * `reputation_history` (CIBIL-rebased 300–900 scores). core-api only writes
 * the denormalised `merchants/users.reputation_score` columns it needs for
 * matching. Keeping one writer per table is what stops the leaderboard
 * (which reads `reputation_scores`) from disagreeing with the in-app score
 * (which recomputes the same settle calculator live). Previously core-api's
 * 5-minute sweep clobbered these rows with a different algorithm + scale,
 * so the leaderboard showed ~400 / 'diamond' for everyone.
 *
 * Two cadences:
 *   - FAST loop  (REPUTATION_RECALC_INTERVAL_MS, default 5 min): recompute
 *     only entities with recent activity — keeps the leaderboard fresh
 *     without hammering the DB.
 *   - DAILY loop (24h): full back-fill (catches time-decay drift on inactive
 *     entities + legacy pre-rebase rows), coin/streak sweeps, and history
 *     snapshots.
 *
 * On startup it runs ONE full back-fill so a deploy immediately rescores
 * every stale row core-api previously left behind.
 *
 * Run: npx tsx src/workers/reputation-worker.ts
 */

import { query } from '@/lib/db';
import { updateReputationScore, recordDailySnapshots } from '@/lib/reputation/repository';
import { logger } from '@/lib/logger';
import { sweepCompletedOrders } from '@/lib/coins/awards';
import { runStreakWorker } from '@/lib/coins/streakWorker';

const FAST_INTERVAL_MS = parseInt(process.env.REPUTATION_RECALC_INTERVAL_MS || '300000', 10); // 5 min
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ACTIVITY_WINDOW_HOURS = parseInt(process.env.REPUTATION_ACTIVITY_WINDOW_HOURS || '24', 10);
// Small batches + a short delay keep the recompute (each fires several DB
// reads/writes) within safe connection-pool limits on a tight cadence.
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;

// Shared guard: the fast loop and the daily loop never run concurrently, so
// the heavy daily pass can't pile on top of an in-flight fast pass.
let isRunning = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function recomputeBatched(
  ids: string[],
  entityType: 'merchant' | 'user'
): Promise<{ updated: number; errors: number }> {
  let updated = 0;
  let errors = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map((id) =>
        updateReputationScore(id, entityType)
          .then(() => {
            updated++;
          })
          .catch((err) => {
            errors++;
            logger.error('[ReputationWorker] recompute failed', {
              entityType,
              id,
              error: err instanceof Error ? err.message : String(err),
            });
          })
      )
    );
    if (i + BATCH_SIZE < ids.length) await sleep(BATCH_DELAY_MS);
  }
  return { updated, errors };
}

/**
 * FAST loop: recompute only entities active within ACTIVITY_WINDOW_HOURS.
 * Mirrors the core-api worker's windowing so a 5-min cadence is DB-safe.
 */
async function refreshActiveScores(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  try {
    const merchants = await query<{ id: string }>(
      `SELECT m.id FROM merchants m
       WHERE m.status = 'active'
         AND (
           m.updated_at > NOW() - ($1 || ' hours')::interval
           OR EXISTS (
             SELECT 1 FROM orders o
             WHERE (o.merchant_id = m.id OR o.buyer_merchant_id = m.id)
               AND (o.completed_at > NOW() - ($1 || ' hours')::interval
                 OR o.cancelled_at > NOW() - ($1 || ' hours')::interval
                 OR o.created_at > NOW() - ($1 || ' hours')::interval)
           )
         )`,
      [ACTIVITY_WINDOW_HOURS.toString()]
    );

    const users = await query<{ id: string }>(
      `SELECT DISTINCT u.id FROM users u
       INNER JOIN orders o ON o.user_id = u.id
       WHERE o.completed_at > NOW() - ($1 || ' hours')::interval
          OR o.cancelled_at > NOW() - ($1 || ' hours')::interval
          OR o.created_at > NOW() - ($1 || ' hours')::interval`,
      [ACTIVITY_WINDOW_HOURS.toString()]
    );

    const m = await recomputeBatched(merchants.map((r) => r.id), 'merchant');
    const u = await recomputeBatched(users.map((r) => r.id), 'user');
    logger.info('[ReputationWorker] fast refresh done', {
      merchants: m.updated,
      users: u.updated,
      errors: m.errors + u.errors,
    });
  } catch (err) {
    logger.error('[ReputationWorker] fast refresh error', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    isRunning = false;
  }
}

/**
 * Full back-fill: recompute EVERY leaderboard-visible entity (active
 * merchants, anything already carrying a reputation_scores row, or users
 * with a completed trade). Rescore inactive/legacy rows the fast loop skips.
 */
async function fullRecompute(): Promise<void> {
  const merchants = await query<{ id: string }>(
    `SELECT DISTINCT m.id FROM merchants m
     WHERE m.status = 'active'
        OR EXISTS (SELECT 1 FROM reputation_scores rs
                   WHERE rs.entity_type = 'merchant' AND rs.entity_id = m.id)`
  );
  const users = await query<{ id: string }>(
    `SELECT DISTINCT u.id FROM users u
     WHERE EXISTS (SELECT 1 FROM reputation_scores rs
                   WHERE rs.entity_type = 'user' AND rs.entity_id = u.id)
        OR EXISTS (SELECT 1 FROM orders o
                   WHERE o.user_id = u.id AND o.status = 'completed')`
  );
  const m = await recomputeBatched(merchants.map((r) => r.id), 'merchant');
  const u = await recomputeBatched(users.map((r) => r.id), 'user');
  logger.info('[ReputationWorker] full back-fill done', {
    merchants: m.updated,
    users: u.updated,
    errors: m.errors + u.errors,
  });
}

/**
 * DAILY loop: full back-fill (drift + legacy rows) + coin/streak sweeps +
 * history snapshots.
 */
async function dailyMaintenance(): Promise<void> {
  if (isRunning) return; // a fast pass is in flight — retry next daily tick
  isRunning = true;
  try {
    await fullRecompute();

    // Coin economy sweeps — idempotent via source_ref so a restart mid-run
    // is safe. Run AFTER rep recompute so new coin events influence the next
    // rep-input pull (rep reads blip_point_log via the task-completion bonus).
    try {
      const coinSweep = await sweepCompletedOrders(48);
      logger.info('[ReputationWorker] Coin sweep done', { ...coinSweep });
    } catch (err) {
      logger.error('[ReputationWorker] Coin sweep failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const streakStats = await runStreakWorker();
      logger.info('[ReputationWorker] Streak/dispute-free sweep done', { ...streakStats });
    } catch (err) {
      logger.error('[ReputationWorker] Streak sweep failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // History snapshots: settle now owns reputation_history too, so it must
    // record the daily trail (core-api used to, on the wrong scale).
    try {
      await recordDailySnapshots();
      logger.info('[ReputationWorker] Daily snapshots recorded');
    } catch (err) {
      logger.error('[ReputationWorker] Snapshot recording failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } catch (error) {
    logger.error('[ReputationWorker] daily maintenance error', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    isRunning = false;
  }
}

async function start(): Promise<void> {
  // One full back-fill on startup so a deploy immediately rescores every
  // stale row core-api left behind (fixes the ~400 / 'diamond' leaderboard).
  await dailyMaintenance();

  // Fast incremental refresh on a tight cadence; full maintenance daily.
  setInterval(refreshActiveScores, FAST_INTERVAL_MS);
  setInterval(dailyMaintenance, DAILY_INTERVAL_MS);
  logger.info('[ReputationWorker] started', {
    fastIntervalMs: FAST_INTERVAL_MS,
    dailyIntervalMs: DAILY_INTERVAL_MS,
    activityWindowHours: ACTIVITY_WINDOW_HOURS,
  });
}

// Run directly = standalone process (e.g. spawned by server.js in prod).
// When imported instead (dev instrumentation calls `start()`), we must NOT
// register process-exit handlers — that would short-circuit Next.js's own
// graceful shutdown.
if (require.main === module) {
  // Standalone (PM2 or `tsx src/workers/...`) has no Next.js to load .env,
  // and src/lib/db reads process.env.DB_* directly. Load settle/.env.local
  // when the DB host isn't already provided by the ambient env (production
  // injects it via PM2/shell). Node 22+ ships process.loadEnvFile natively;
  // cast guards against an older @types/node. cwd is ./settle under PM2.
  if (!process.env.DB_HOST) {
    const loadEnvFile = (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile;
    try {
      loadEnvFile?.('.env.local');
    } catch {
      /* no .env.local on disk — rely on ambient env */
    }
  }
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  start().catch((error) => {
    console.error('[ReputationWorker] Failed to start worker:', error);
    process.exit(1);
  });
}

export { start, refreshActiveScores, dailyMaintenance };
