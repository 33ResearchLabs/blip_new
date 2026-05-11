/**
 * GET /api/wallet/unlock-helper
 *
 * Returns the authenticated actor's wallet unlock helper — a per-user
 * (or per-merchant) random 32-byte secret that is mixed into the embedded
 * wallet's PBKDF2 input. An attacker with only the offline localStorage
 * blob cannot brute-force the wallet, because the password alone is
 * insufficient to derive the encryption key — they have to authenticate
 * AND survive the rate limiter below.
 *
 * Security properties (Step 3 of wallet hardening roadmap):
 *   - Cookie-auth gated (requireAuth) — anonymous callers get 401.
 *   - Rate-limited to 30 GETs / minute per IP. Realistic human unlock
 *     cadence is 1–2 per session; 30 leaves headroom for retries / tab
 *     reload / forgot-password without enabling rapid extraction.
 *   - Helper is generated lazily on first call. Existing users get a
 *     helper minted the first time they hit this endpoint.
 *   - Helper is server-secret. NEVER return it from any other endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { query, queryOne } from '@/lib/db';
import {
  requireAuth,
  successResponse,
  errorResponse,
  forbiddenResponse,
} from '@/lib/middleware/auth';
import { checkRateLimit } from '@/lib/middleware/rateLimit';

export const dynamic = 'force-dynamic';

// 30 GETs/min/IP — generous for normal use, far below brute-force cadence.
const RATE_LIMIT = { maxRequests: 30, windowSeconds: 60 };

function generateHelper(): string {
  // 32 bytes = 256 bits of entropy, base64-encoded for safe transport.
  return randomBytes(32).toString('base64');
}

export async function GET(request: NextRequest) {
  const rate = await checkRateLimit(request, 'wallet_unlock_helper', RATE_LIMIT);
  if (rate) return rate;

  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
      return forbiddenResponse('Embedded wallet is only available for user and merchant accounts');
    }

    const table = auth.actorType === 'user' ? 'users' : 'merchants';
    const actorId = auth.actorId;

    const existing = await queryOne<{ wallet_unlock_helper: string | null }>(
      `SELECT wallet_unlock_helper FROM ${table} WHERE id = $1`,
      [actorId],
    );

    if (!existing) {
      return forbiddenResponse('Account not found');
    }

    if (existing.wallet_unlock_helper) {
      return successResponse({ unlock_helper: existing.wallet_unlock_helper });
    }

    // First call for this actor: mint + persist. `WHERE wallet_unlock_helper
    // IS NULL` avoids clobbering a helper minted by a concurrent request.
    const helper = generateHelper();
    await query(
      `UPDATE ${table}
       SET wallet_unlock_helper = $2
       WHERE id = $1 AND wallet_unlock_helper IS NULL`,
      [actorId, helper],
    );

    const reread = await queryOne<{ wallet_unlock_helper: string | null }>(
      `SELECT wallet_unlock_helper FROM ${table} WHERE id = $1`,
      [actorId],
    );

    if (!reread?.wallet_unlock_helper) {
      return errorResponse('Failed to mint wallet unlock helper');
    }

    return successResponse({ unlock_helper: reread.wallet_unlock_helper });
  } catch (err) {
    console.error('[unlock-helper] error:', err);
    return errorResponse('Internal server error');
  }
}
