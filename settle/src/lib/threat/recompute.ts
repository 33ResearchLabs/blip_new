// Fire-and-forget recompute trigger. Called from mutation paths (register,
// task verify, referral apply) to refresh an actor's threat score after a
// state change. Always non-blocking — failures are logged but never thrown.
//
// CRITICAL: this must never block or fail the calling request. The whole
// threat-scoring system is read-side enrichment for admin review — it does
// not gate any user-facing flow.

import { recomputeAndPersist } from './service';
import type { ActorType } from './types';

export function triggerRecompute(actorType: ActorType, actorId: string): void {
  // No await — let the recompute happen in the background. Errors are caught
  // inside recomputeAndPersist and never propagated. The catch on the
  // promise chain is defence-in-depth in case a future refactor lets one
  // through.
  recomputeAndPersist(actorType, actorId).catch(err => {
    console.error('[threat/recompute] background recompute failed', { actorType, actorId, err });
  });
}

/** Triggers recompute for an actor AND the referrer that referred them (if any).
 *  Used at signup time so a new referee causes the referrer's ring-detection
 *  signals to update immediately. */
export async function triggerRecomputeWithReferrer(
  actorType: ActorType,
  actorId: string,
  referrer?: { type: ActorType; id: string } | null,
): Promise<void> {
  triggerRecompute(actorType, actorId);
  if (referrer) triggerRecompute(referrer.type, referrer.id);
}
