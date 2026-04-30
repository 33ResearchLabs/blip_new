/**
 * Merchant identity helpers — replace `request.headers.get('x-merchant-id')`.
 *
 * The JWT issued by `requireAuth` cryptographically binds `actorType` and
 * `actorId`. For merchant-typed tokens, `auth.actorId` IS the merchant id.
 * Reading the same identity from a request header opens an impersonation
 * channel: any authenticated merchant can put `x-merchant-id: <victim>` and
 * `actor_id: <victim>` in the body, and the legacy "actor swap" pattern
 * routes scattered through the API would happily reassign
 * `auth.actorId = <victim>`.
 *
 * Use the helpers in this module instead of reading the header.
 *
 * Migration scope: per-route reads where the header was used as an
 * IDENTITY source. The central `getAuthContext` middleware still reads the
 * header but is correctly guarded (`tokenPayload.actorType === 'merchant'`)
 * and the rate-limit module uses it as a bucketing key — neither is part
 * of the impersonation surface.
 */

import { NextResponse } from 'next/server';
import { AuthContext, forbiddenResponse } from './auth';

/**
 * Return the verified merchant id for a token-authenticated request, or
 * null if the actor is not a merchant. The id is the JWT-bound `actorId`
 * — never read from the request body or headers.
 */
export function getMerchantId(auth: AuthContext): string | null {
  if (auth.actorType !== 'merchant') return null;
  return auth.actorId;
}

/**
 * Same as `getMerchantId`, but returns a 403 NextResponse when the caller
 * isn't authenticated as a merchant. Use at routes that are merchant-only.
 */
export function requireMerchantActor(auth: AuthContext): string | NextResponse {
  const id = getMerchantId(auth);
  if (!id) {
    return forbiddenResponse('Merchant authentication required');
  }
  return id;
}

/**
 * Verify the body's `actor_id` (and optionally `actor_type`) matches the
 * authenticated identity. Replaces the per-route pattern:
 *
 *   const headerMerchantId = request.headers.get('x-merchant-id');
 *   const actorMatchesAuth = actor_id === auth.actorId;
 *   const actorMatchesMerchant =
 *     actor_type === 'merchant' && auth.actorType === 'merchant'
 *     && headerMerchantId && actor_id === headerMerchantId;
 *   if (!actorMatchesAuth && !actorMatchesMerchant) return 403;
 *
 * The header branch is dropped: actor_id MUST equal auth.actorId. If body
 * carries `actor_type === 'merchant'`, `auth.actorType` must also be
 * `'merchant'` — prevents user tokens from claiming merchant role.
 *
 * Returns null on success, or a 403 NextResponse the caller should return.
 */
export function assertActorMatchesAuth(
  auth: AuthContext,
  body: { actor_id?: string | null; actor_type?: string | null }
): NextResponse | null {
  if (!body.actor_id || body.actor_id !== auth.actorId) {
    return forbiddenResponse('actor_id does not match authenticated identity');
  }
  if (body.actor_type && body.actor_type !== auth.actorType) {
    return forbiddenResponse(
      `actor_type='${body.actor_type}' does not match authenticated identity (${auth.actorType})`
    );
  }
  return null;
}
