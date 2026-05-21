// Waitlist activation step that runs immediately after the existing
// register flow creates a users/merchants row. Non-invasive — only invoked
// when the caller passes `waitlist: true`, so the standard register paths
// remain untouched.
//
// Steps:
//   1. Flip the row to waitlist_status='waitlisted', stamp joined_at + source.
//   2. Assign a unique referral_code (retry on rare collisions).
//   3. Credit REGISTER / MERCHANT_REGISTER points (idempotent — unique log).
//   4. If a referral code was supplied, apply it (credits both sides).

import { queryOne } from '@/lib/db';
import { creditPoints } from './credit';
import { generateReferralCode, applyReferral } from './referral';
import { getRegisterPoints } from './blipPoints';
import type { WaitlistActorType } from '@/lib/types/database';

interface SetupWaitlistArgs {
  actorId: string;
  actorType: WaitlistActorType;
  source?: string;
  referralCode?: string;
}

export interface SetupWaitlistResult {
  referralCode: string;
  totalPoints: number;
  registerCredited: boolean;
  referralApplied: boolean;
  referralReason?: string;
}

export async function setupWaitlistForActor(args: SetupWaitlistArgs): Promise<SetupWaitlistResult> {
  const { actorId, actorType, source, referralCode } = args;
  const table = actorType === 'merchant' ? 'merchants' : 'users';

  // 1+2. Flip status + assign a unique referral code. Retry on collision.
  const MAX_RETRIES = 5;
  let assignedCode = '';
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    const candidate = generateReferralCode();
    try {
      const updated = await queryOne<{ referral_code: string }>(
        `UPDATE ${table}
            SET waitlist_status = 'waitlisted',
                waitlist_joined_at = COALESCE(waitlist_joined_at, NOW()),
                waitlist_source = COALESCE(waitlist_source, $2),
                referral_code = COALESCE(referral_code, $3),
                updated_at = NOW()
          WHERE id = $1
          RETURNING referral_code`,
        [actorId, source ?? 'waitlist_page', candidate],
      );
      if (!updated) throw new Error(`actor ${actorId} not found in ${table}`);
      assignedCode = updated.referral_code;
      break;
    } catch (err: unknown) {
      // 23505 = unique_violation on the partial referral_code index. Retry.
      const code = (err as { code?: string })?.code;
      if (code === '23505') {
        attempt += 1;
        continue;
      }
      throw err;
    }
  }
  if (!assignedCode) {
    throw new Error('Could not assign unique referral code after retries');
  }

  // 3. Credit register points (idempotent).
  const event = actorType === 'merchant' ? 'MERCHANT_REGISTER' : 'REGISTER';
  const registerPoints = getRegisterPoints(actorType);
  const regResult = await creditPoints({
    actorId,
    actorType,
    event,
    points: registerPoints,
  });

  // 4. Apply referral if supplied. Errors are non-fatal — the signup itself
  // already succeeded; an invalid referral code just means no bonus.
  let referralApplied = false;
  let referralReason: string | undefined;
  if (referralCode) {
    try {
      const refResult = await applyReferral({
        referralCode,
        refereeId: actorId,
        refereeType: actorType,
      });
      referralApplied = refResult.applied;
      referralReason = refResult.reason;
    } catch (err) {
      console.error('[waitlist/setup] referral apply failed', err);
      referralReason = 'error';
    }
  }

  // Fetch the up-to-date total (referral may have added to it).
  const balanceRow = await queryOne<{ blip_points: number }>(
    `SELECT blip_points FROM ${table} WHERE id = $1`,
    [actorId],
  );

  return {
    referralCode: assignedCode,
    totalPoints: balanceRow?.blip_points ?? regResult.totalPoints,
    registerCredited: !regResult.alreadyCredited,
    referralApplied,
    referralReason,
  };
}
