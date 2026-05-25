// Positive credits — engagement signals that reduce the final score.
// Pure function over the context.

import type { ScoringContext } from './types';
import { POSITIVE_CREDITS, POSITIVE_CREDIT_CAP } from './weights';

export interface PositiveCreditBreakdown {
  email_verified: number;
  verified_tasks: number;
  phone_verified: number;
  total: number;
}

export function computePositiveCredits(ctx: ScoringContext): PositiveCreditBreakdown {
  let emailCredit = 0;
  let taskCredit = 0;
  let phoneCredit = 0;

  if (ctx.actor.email_verified === true) {
    emailCredit = POSITIVE_CREDITS.EMAIL_VERIFIED;
  }

  const verifiedTaskCount = ctx.tasks.filter(t => t.status === 'VERIFIED').length;
  taskCredit = Math.min(
    POSITIVE_CREDITS.PER_VERIFIED_TASK_CAP,
    verifiedTaskCount * POSITIVE_CREDITS.PER_VERIFIED_TASK,
  );

  // Phone credit: phone column not present on the actor row in Phase A
  // (User/Merchant types declare it but we don't fetch it in the threat
  // pipeline yet). Reserved for future use; currently always 0.

  const total = Math.min(POSITIVE_CREDIT_CAP, emailCredit + taskCredit + phoneCredit);
  return { email_verified: emailCredit, verified_tasks: taskCredit, phone_verified: phoneCredit, total };
}
