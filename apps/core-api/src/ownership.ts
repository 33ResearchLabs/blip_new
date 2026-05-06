/**
 * Ownership Assertions — defense-in-depth against trusted-channel IDOR.
 *
 * Background:
 *   - settle authenticates the user, then proxies to core-api with
 *       x-core-api-secret  (channel auth, HMAC base secret)
 *       x-actor-type       (caller's role: 'user' | 'merchant' | …)
 *       x-actor-id         (caller's id, taken from settle's verified session)
 *       x-actor-signature  (HMAC-SHA256(secret, "type:id"))
 *   - the auth hook (src/hooks/auth.ts) verifies the signature and ensures
 *     the actor-id was minted by a holder of CORE_API_SECRET.
 *
 * Gap this module closes:
 *   Routes accept identity fields *in the request body* (account_id,
 *   actor_id, partyId) and act on them. Today nothing forces those body
 *   fields to match the (signed) x-actor-id in the headers. So:
 *     1. A logged-in user could send body.account_id = victim  → IDOR.
 *     2. If CORE_API_SECRET leaks, an attacker forging arbitrary actor
 *        headers could combine that with a different body.account_id —
 *        without binding the two, lateral movement is unconstrained.
 *
 * Both helpers below take the same conservative stance:
 *   - missing x-actor-id  → 403 (fail-safe; no implicit "trust the body")
 *   - mismatch            → 403, structured warn log for ops
 *   - match               → null, caller proceeds with existing behavior
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from 'settlement-core';

interface AssertActorOptions {
  /** The id the route is about to act on (from body / params / derived). */
  expectedActorId: string;
  /** Optional: also bind type ('user' | 'merchant' | …). When the header is
   *  present and disagrees, reject. When the header is absent, do not require
   *  it — some legitimate proxy callers don't send it today. */
  expectedActorType?: string;
  /** Free-form label for structured logs, e.g. 'convert_usdt_to_sinr'. */
  context: string;
}

/**
 * Verify request's x-actor-id (and optionally x-actor-type) match the
 * resource the route is about to act on.
 *
 * @returns FastifyReply if rejected (caller must `return` it), else null.
 */
export function assertActorOwnership(
  request: FastifyRequest,
  reply: FastifyReply,
  opts: AssertActorOptions,
): FastifyReply | null {
  const headerActorId = request.headers['x-actor-id'];
  const headerActorType = request.headers['x-actor-type'];

  if (typeof headerActorId !== 'string' || headerActorId.length === 0) {
    logger.warn('[Ownership] Missing x-actor-id — rejecting', {
      context: opts.context,
      expectedActorId: opts.expectedActorId,
      url: request.url,
    });
    return reply.status(403).send({
      success: false,
      error: 'Actor identity required',
    });
  }

  if (headerActorId !== opts.expectedActorId) {
    logger.warn('[Ownership] Actor id mismatch — rejecting', {
      context: opts.context,
      headerActorId,
      expectedActorId: opts.expectedActorId,
      url: request.url,
    });
    return reply.status(403).send({
      success: false,
      error: 'Actor identity does not match resource owner',
    });
  }

  if (
    opts.expectedActorType &&
    typeof headerActorType === 'string' &&
    headerActorType !== opts.expectedActorType
  ) {
    logger.warn('[Ownership] Actor type mismatch — rejecting', {
      context: opts.context,
      headerActorType,
      expectedActorType: opts.expectedActorType,
      url: request.url,
    });
    return reply.status(403).send({
      success: false,
      error: 'Actor type does not match resource',
    });
  }

  return null;
}

/**
 * Variant for resources with multiple legitimate participants (an order
 * can be accessed by user_id, merchant_id, or buyer_merchant_id). The
 * header actor must match one of the candidate ids.
 *
 * Note: we do NOT add a 'system'/'compliance' bypass here. Any future
 * privileged-actor exception must be opted into explicitly and audited
 * separately — silent bypasses are exactly the surface this layer exists
 * to remove.
 */
export function assertActorIsParticipant(
  request: FastifyRequest,
  reply: FastifyReply,
  candidateIds: ReadonlyArray<string | null | undefined>,
  context: string,
): FastifyReply | null {
  const headerActorId = request.headers['x-actor-id'];
  const valid = candidateIds.filter((id): id is string => typeof id === 'string' && id.length > 0);

  if (typeof headerActorId !== 'string' || !valid.includes(headerActorId)) {
    logger.warn('[Ownership] Actor not a participant — rejecting', {
      context,
      headerActorId: typeof headerActorId === 'string' ? headerActorId : '(missing)',
      candidateCount: valid.length,
      url: request.url,
    });
    return reply.status(403).send({
      success: false,
      error: 'Not authorized for this resource',
    });
  }

  return null;
}
