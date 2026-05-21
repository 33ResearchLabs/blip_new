/**
 * One-time per-actor bootstrap of the in-app economy:
 *   - Seeds the reputation_scores row at 500 (the "New" tier baseline)
 *   - Grants 100 starter Blip Points via the existing ledger
 *
 * Idempotent — both writes use ON CONFLICT DO NOTHING anchored on a
 * fixed source_ref ('signup_starter'). Safe to call from every signup
 * code path even if those paths converge on the same DB row.
 */

import { query } from '@/lib/db';
import type { WaitlistActorType } from '@/lib/types/database';

const STARTER_COINS = 100;
const STARTER_REP   = 500;

export async function bootstrapNewActor(
  actorId: string,
  actorType: WaitlistActorType,
): Promise<void> {
  if (!actorId) return;

  // ----- 1) Seed default reputation row at 500. ON CONFLICT keeps the
  //          existing row if one already exists. We then bump any
  //          stale sub-300 score (pre-rebase rows that escaped
  //          migration 133, or rows from before the rebase landed) up
  //          to the New-tier baseline so users don't see "0 Rep".
  try {
    await query(
      `INSERT INTO reputation_scores
         (entity_id, entity_type, total_score, review_score, execution_score,
          volume_score, consistency_score, trust_score, tier, badges,
          calculated_at, created_at, updated_at)
       VALUES ($1, $2, $3, 50, 0, 0, 0, 50, 'newcomer', ARRAY[]::text[],
               NOW(), NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [actorId, actorType, STARTER_REP],
    );
    // Belt-and-braces: rescale any legacy 0-1000 row to the 300-900
    // scale. Idempotent — leaves real scores >= 300 alone. Real recomputes
    // from the daily worker land later and override this default.
    await query(
      `UPDATE reputation_scores
          SET total_score = $1, tier = 'newcomer', updated_at = NOW()
        WHERE entity_id = $2 AND entity_type = $3 AND total_score < 300`,
      [STARTER_REP, actorId, actorType],
    );
  } catch (err) {
    // Non-fatal — the daily worker will compute a real score later.
    console.error('[onboarding] seed rep failed', err);
  }

  // ----- 2) Grant 100 starter Blip Points. Uses the idempotency partial
  //          index (actor, event, source_ref) so a second call is a no-op.
  try {
    const table = actorType === 'merchant' ? 'merchants' : 'users';
    // Insert ledger row first — ON CONFLICT means a second call returns
    // 0 rows and we skip the balance bump.
    const ins = await query<{ id: string }>(
      `INSERT INTO blip_point_log
         (actor_id, actor_type, event, bonus_points, source_ref, metadata)
       VALUES ($1, $2, 'MANUAL_CREDIT', $3, 'signup_starter',
               '{"reason":"signup_starter_coin_grant"}'::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [actorId, actorType, STARTER_COINS],
    );
    if (ins.length > 0) {
      await query(
        `UPDATE ${table}
            SET blip_points = GREATEST(COALESCE(blip_points, 0), $1),
                updated_at = NOW()
          WHERE id = $2`,
        [STARTER_COINS, actorId],
      );
    }
  } catch (err) {
    console.error('[onboarding] starter coin grant failed', err);
  }
}
