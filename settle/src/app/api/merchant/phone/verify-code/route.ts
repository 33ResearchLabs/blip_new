/**
 * POST /api/merchant/phone/verify-code
 *
 * Verifies the 6-digit SMS OTP issued by /api/merchant/phone/send-code.
 * On success the pending number is promoted to the merchant's verified phone
 * (`phone_verified = true`). Codes are single-use, expire in 10 minutes, and
 * lock out after 5 failed attempts.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import {
  requireAuth,
  errorResponse,
  successResponse,
  validationErrorResponse,
  forbiddenResponse,
} from '@/lib/middleware/auth';
import { checkRateLimit, AUTH_LIMIT } from '@/lib/middleware/rateLimit';
import { query, queryOne, transaction } from '@/lib/db';
import { invalidateMerchantCache } from '@/lib/cache';
import { verifyPhoneCodeSchema } from '@/lib/validation/schemas';

const MAX_ATTEMPTS = 5;

export async function POST(request: NextRequest) {
  const rl = await checkRateLimit(request, 'merchant:phone:verify-code', AUTH_LIMIT);
  if (rl) return rl;

  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.actorType !== 'merchant') {
      return forbiddenResponse('Phone verification is only available for merchants');
    }
    const merchantId = auth.actorId;

    const body = await request.json().catch(() => null);
    const parsed = verifyPhoneCodeSchema.safeParse(body);
    if (!parsed.success) {
      return validationErrorResponse(parsed.error.issues.map((i) => i.message));
    }
    const { code } = parsed.data;

    const row = await queryOne<{
      id: string;
      phone: string;
      code_hash: string;
      attempts: number;
    }>(
      `SELECT id, phone, code_hash, attempts FROM phone_verification_codes
        WHERE merchant_id = $1 AND consumed_at IS NULL AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1`,
      [merchantId]
    );

    if (!row) {
      return errorResponse('Your code has expired. Request a new one.', 400);
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      return errorResponse('Too many incorrect attempts. Request a new code.', 429);
    }

    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    // Both sides are fixed-length SHA-256 hex, so timingSafeEqual is safe and
    // avoids leaking match progress via comparison time.
    const matches = crypto.timingSafeEqual(Buffer.from(codeHash), Buffer.from(row.code_hash));

    if (!matches) {
      await query(
        `UPDATE phone_verification_codes SET attempts = attempts + 1 WHERE id = $1`,
        [row.id]
      );
      const remaining = MAX_ATTEMPTS - (row.attempts + 1);
      return errorResponse(
        remaining > 0
          ? `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} left.`
          : 'Too many incorrect attempts. Request a new code.',
        400
      );
    }

    // Consume the code and promote the verified number in one transaction.
    await transaction(async (client) => {
      await client.query(
        `UPDATE phone_verification_codes SET consumed_at = NOW() WHERE id = $1`,
        [row.id]
      );
      await client.query(
        `UPDATE merchants
            SET phone = $1, phone_verified = true, phone_verified_at = NOW(), updated_at = NOW()
          WHERE id = $2`,
        [row.phone, merchantId]
      );
    });
    invalidateMerchantCache(merchantId);

    return successResponse({ phone: row.phone, phone_verified: true });
  } catch (error) {
    console.error('[Phone Verify verify-code] error:', error);
    return errorResponse('Verification failed. Please try again.');
  }
}
