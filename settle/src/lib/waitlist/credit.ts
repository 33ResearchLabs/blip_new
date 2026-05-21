// Atomic point crediting for the waitlist airdrop. All point movements go
// through these helpers so the audit log stays the single source of truth and
// the denormalized blip_points column on users/merchants stays in sync.

import { query, queryOne, transaction } from '@/lib/db';
import type {
  BlipPointEvent,
  BlipPointLogEntry,
  WaitlistActorType,
} from '@/lib/types/database';

interface CreditPointsArgs {
  actorId: string;
  actorType: WaitlistActorType;
  event: BlipPointEvent;
  points: number;
  metadata?: Record<string, unknown>;
}

interface CreditResult {
  log: BlipPointLogEntry | null;
  totalPoints: number;
  /** True when the unique constraint blocked a second register credit. */
  alreadyCredited: boolean;
}

/**
 * Credit waitlist points atomically. On race / retry, the unique index on
 * (actor_type, actor_id, event) for REGISTER / MERCHANT_REGISTER stops a
 * second credit; the function returns the existing row.
 */
export async function creditPoints(args: CreditPointsArgs): Promise<CreditResult> {
  const { actorId, actorType, event, points, metadata = {} } = args;
  const table = actorType === 'merchant' ? 'merchants' : 'users';

  return transaction(async (client) => {
    // Insert the audit row first. Use ON CONFLICT DO NOTHING so race retries
    // on REGISTER / MERCHANT_REGISTER are no-ops (the partial unique index).
    const insertSql = `
      INSERT INTO blip_point_log (actor_id, actor_type, event, bonus_points, metadata)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT DO NOTHING
      RETURNING *
    `;
    const insertRes = await client.query<BlipPointLogEntry>(insertSql, [
      actorId, actorType, event, points, metadata,
    ]);

    if (insertRes.rows.length === 0) {
      // Conflict — fetch current total and bail without re-crediting.
      const balRes = await client.query<{ blip_points: number }>(
        `SELECT blip_points FROM ${table} WHERE id = $1`,
        [actorId],
      );
      return {
        log: null,
        totalPoints: balRes.rows[0]?.blip_points ?? 0,
        alreadyCredited: true,
      };
    }

    // Bump the denormalized counter.
    const bumpRes = await client.query<{ blip_points: number }>(
      `UPDATE ${table} SET blip_points = COALESCE(blip_points, 0) + $1, updated_at = NOW()
       WHERE id = $2
       RETURNING blip_points`,
      [points, actorId],
    );

    const newTotal = bumpRes.rows[0]?.blip_points ?? points;

    // Snapshot the post-credit total on the log row so the history view shows
    // a running balance without needing a window-sum at read time.
    await client.query(
      `UPDATE blip_point_log SET total_points = $1 WHERE id = $2`,
      [newTotal, insertRes.rows[0].id],
    );

    return {
      log: { ...insertRes.rows[0], total_points: newTotal },
      totalPoints: newTotal,
      alreadyCredited: false,
    };
  });
}

/**
 * Fetch the current point balance for an actor (denormalized read).
 */
export async function getPointBalance(actorId: string, actorType: WaitlistActorType): Promise<number> {
  const table = actorType === 'merchant' ? 'merchants' : 'users';
  const row = await queryOne<{ blip_points: number }>(
    `SELECT blip_points FROM ${table} WHERE id = $1`,
    [actorId],
  );
  return row?.blip_points ?? 0;
}

/**
 * Recent point-log entries for an actor, newest first. Pagination via limit.
 */
export async function getPointHistory(
  actorId: string,
  actorType: WaitlistActorType,
  limit = 50,
): Promise<BlipPointLogEntry[]> {
  return query<BlipPointLogEntry>(
    `SELECT * FROM blip_point_log
      WHERE actor_type = $1 AND actor_id = $2
   ORDER BY created_at DESC
      LIMIT $3`,
    [actorType, actorId, limit],
  );
}
