// Bulk-upsert of community-membership rows into
// waitlist_community_membership. Truncate-and-load pattern: every cron run
// recomputes from scratch, so the cleanest write is to delete rows whose
// last_computed_at is older than this run (after the upsert) — that way
// actors that have left the waitlisted set automatically age out.

import { query } from '@/lib/db';
import type { ActorAnomaly } from './anomaly';

export interface PersistSummary {
  upserted: number;
  pruned: number;
}

/** Upsert all per-actor anomaly rows. Idempotent — re-runs produce the same
 *  state. Returns counts for the cron summary. */
export async function persistCommunityAssignments(
  rows: ActorAnomaly[],
): Promise<PersistSummary> {
  const runStartedAt = new Date().toISOString();

  // Batch the upserts — Postgres handles ~1000-row VALUES lists fine; for
  // larger graphs we chunk to keep individual queries bounded.
  const BATCH = 500;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    if (chunk.length === 0) continue;
    const values: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    for (const r of chunk) {
      values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, NOW())`);
      params.push(
        r.actor_id, r.actor_type, r.community_id, r.anomaly_score,
        r.community_size, r.community_density, r.age_spread_seconds,
        r.unique_ips, r.unique_devices,
      );
    }
    await query(
      `INSERT INTO waitlist_community_membership
         (actor_id, actor_type, community_id, anomaly_score,
          community_size, community_density, age_spread_seconds,
          unique_ips, unique_devices, last_computed_at)
       VALUES ${values.join(', ')}
       ON CONFLICT (actor_type, actor_id) DO UPDATE SET
         community_id        = EXCLUDED.community_id,
         anomaly_score       = EXCLUDED.anomaly_score,
         community_size      = EXCLUDED.community_size,
         community_density   = EXCLUDED.community_density,
         age_spread_seconds  = EXCLUDED.age_spread_seconds,
         unique_ips          = EXCLUDED.unique_ips,
         unique_devices      = EXCLUDED.unique_devices,
         last_computed_at    = NOW()`,
      params,
    );
    upserted += chunk.length;
  }

  // Prune rows we DIDN'T just upsert — actors that activated/rejected
  // since the last run, or that no longer match the waitlist filter. We
  // compare against the run-start timestamp.
  const pruned = await query<{ id: string }>(
    `DELETE FROM waitlist_community_membership
      WHERE last_computed_at < $1
      RETURNING actor_id AS id`,
    [runStartedAt],
  );

  return { upserted, pruned: pruned.length };
}
