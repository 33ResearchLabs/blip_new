/**
 * GET /api/auth/me
 *
 * The single source of truth for "who is the current actor?" Reads the
 * httpOnly access cookie via requireAuth, looks up the actor in the DB, and
 * returns a sanitized DTO. The frontend uses this in place of
 * `localStorage.getItem('blip_merchant')` (and equivalents) — that pattern
 * trusted client-stored identity, which the server should NEVER do.
 *
 * Response:
 *   200 → { success: true, data: { actorType, actorId, merchant?, user?, member? } }
 *   401 → { success: false, error: 'Session expired' }   (cookie missing / invalid)
 *   404 → { success: false, error: '<actor> not found' } (actor revoked since cookie was minted)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, errorResponse, successResponse } from '@/lib/middleware/auth';
import { checkRateLimit, STANDARD_LIMIT } from '@/lib/middleware/rateLimit';
import { query, queryOne } from '@/lib/db';
import { serializeMerchant } from '@/lib/db/repositories/merchants';
import { getUserById } from '@/lib/db/repositories/users';

export async function GET(request: NextRequest) {
  const rl = await checkRateLimit(request, 'auth:me', STANDARD_LIMIT);
  if (rl) return rl;

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    if (auth.actorType === 'merchant') {
      // `dashboard_layout` was added in migration 146. If the DB is one
      // migration behind (e.g. dev forgot to restart core-api so its
      // runner hasn't applied 146 yet), the column is missing and the
      // SELECT throws — which used to cascade into a 500 here, then a
      // wiped client store, then the consecutive-401 counter pushing the
      // user to /merchant/login?reason=session_expired. Catch the
      // specific "column does not exist" case and fall back to the
      // pre-146 projection so auth never collapses over a schema lag.
      const SELECT_WITH_LAYOUT = `SELECT id, username, display_name, business_name, wallet_address,
                avatar_url, bio, email, rating, total_trades, is_online, balance,
                has_ops_access, dashboard_layout, created_at,
                COALESCE(has_compliance_access, false) as has_compliance_access
         FROM merchants
         WHERE id = $1 AND status = 'active'`;
      const SELECT_WITHOUT_LAYOUT = `SELECT id, username, display_name, business_name, wallet_address,
                avatar_url, bio, email, rating, total_trades, is_online, balance,
                has_ops_access, created_at,
                COALESCE(has_compliance_access, false) as has_compliance_access
         FROM merchants
         WHERE id = $1 AND status = 'active'`;
      let rows;
      try {
        rows = await query(SELECT_WITH_LAYOUT, [auth.actorId]);
      } catch (err) {
        // pg error code 42703 = "undefined_column". Other errors propagate.
        const code = (err as { code?: string })?.code;
        if (code === '42703') {
          console.warn('[GET /api/auth/me] dashboard_layout column missing — apply migration 146');
          rows = await query(SELECT_WITHOUT_LAYOUT, [auth.actorId]);
        } else {
          throw err;
        }
      }
      if (rows.length === 0) return errorResponse('Merchant not found', 404);
      return successResponse({
        actorType: 'merchant' as const,
        actorId: auth.actorId,
        merchant: serializeMerchant(rows[0] as Parameters<typeof serializeMerchant>[0]),
      });
    }

    if (auth.actorType === 'user') {
      const user = await getUserById(auth.actorId);
      if (!user) return errorResponse('User not found', 404);
      return successResponse({
        actorType: 'user' as const,
        actorId: auth.actorId,
        user,
      });
    }

    if (auth.actorType === 'compliance') {
      const member = await queryOne(
        `SELECT id, email, wallet_address, name, role
         FROM compliance_team
         WHERE id = $1 AND is_active = true`,
        [auth.actorId],
      );
      if (!member) return errorResponse('Compliance member not found', 404);
      return successResponse({
        actorType: 'compliance' as const,
        actorId: auth.actorId,
        member,
      });
    }

    return errorResponse('Unsupported actor type', 403);
  } catch (err) {
    console.error('[GET /api/auth/me] error:', err);
    return errorResponse('Failed to load identity');
  }
}
