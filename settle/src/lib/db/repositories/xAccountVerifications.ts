// Repository for x_account_verifications. One row per (actor_type, actor_id)
// enforced by a UNIQUE index, so upsert is the safe API for "verify / re-verify
// my X handle". Self-attested + display-only — see migration 160 and
// /api/limits/x-verification. Independent of the waitlist quest system.

import { queryOne } from '../index';

export type VerificationActorType = 'user' | 'merchant';

export interface XAccountVerification {
  id: string;
  actor_type: VerificationActorType;
  actor_id: string;
  x_username: string;
  status: 'verified';
  verified_at: Date;
  created_at: Date;
  updated_at: Date;
}

/** The actor's X verification, or null if they haven't verified yet. */
export async function getXVerification(
  actorType: VerificationActorType,
  actorId: string,
): Promise<XAccountVerification | null> {
  return queryOne<XAccountVerification>(
    `SELECT * FROM x_account_verifications
      WHERE actor_type = $1 AND actor_id = $2`,
    [actorType, actorId],
  );
}

/**
 * Record (or re-record) the actor's X handle as verified. Idempotent on
 * (actor_type, actor_id): a follow-up just updates the handle + verified_at.
 */
export async function upsertXVerification(
  actorType: VerificationActorType,
  actorId: string,
  xUsername: string,
): Promise<XAccountVerification> {
  const row = await queryOne<XAccountVerification>(
    `INSERT INTO x_account_verifications
        (actor_type, actor_id, x_username, status, verified_at)
     VALUES ($1, $2, $3, 'verified', NOW())
     ON CONFLICT (actor_type, actor_id) DO UPDATE
       SET x_username  = EXCLUDED.x_username,
           status      = 'verified',
           verified_at = NOW(),
           updated_at  = NOW()
     RETURNING *`,
    [actorType, actorId, xUsername],
  );
  if (!row) throw new Error('upsertXVerification: insert returned no row');
  return row;
}
