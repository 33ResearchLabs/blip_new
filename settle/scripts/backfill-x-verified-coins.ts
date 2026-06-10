/**
 * One-off backfill: credit the one-time X_VERIFIED Blip Points bonus to every
 * actor who verified their X account BEFORE the award was wired into
 * /api/limits/x-verification.
 *
 * Idempotent — awardXVerified is lifetime-capped (perPeriodCount: 1) and keyed
 * on sourceRef 'x_verification', so re-running this credits no one twice.
 *
 * Run (loads local DB creds from .env.local):
 *   node --env-file=.env.local --import tsx scripts/backfill-x-verified-coins.ts
 */

import { query } from '../src/lib/db';
import { awardXVerified } from '../src/lib/coins/awards';
import type { WaitlistActorType } from '../src/lib/types/database';

interface VerifRow {
  actor_type: WaitlistActorType;
  actor_id: string;
  x_username: string;
}

async function main() {
  const rows = await query<VerifRow>(
    `SELECT actor_type, actor_id, x_username FROM x_account_verifications`,
  );
  console.log(`Found ${rows.length} verified actor(s).\n`);

  let credited = 0;
  for (const r of rows) {
    const res = await awardXVerified({ actorId: r.actor_id, actorType: r.actor_type });
    if (res.credited > 0) credited += res.credited;
    console.log(
      `${r.actor_type} ${r.actor_id} (@${r.x_username}) → ` +
        `+${res.credited} [${res.reason}], new balance ${res.newBalance}`,
    );
  }

  console.log(`\nDone. Total newly credited: ${credited} points.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
