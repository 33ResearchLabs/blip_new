/**
 * POST /api/merchant/phone/send-code
 *
 * Issues a 6-digit SMS OTP for merchant phone verification via MSG91.
 * The code is stored only as a SHA-256 hash (single-use, 10-min expiry),
 * mirroring the email-verification token model. Heavily rate limited +
 * 60s resend cooldown because each send costs real money.
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
import { query, queryOne } from '@/lib/db';
import { sendPhoneCodeSchema } from '@/lib/validation/schemas';
import { sendOtpSms, isSmsConfigured } from '@/lib/sms/msg91';

export async function POST(request: NextRequest) {
  const rl = await checkRateLimit(request, 'merchant:phone:send-code', AUTH_LIMIT);
  if (rl) return rl;

  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.actorType !== 'merchant') {
      return forbiddenResponse('Phone verification is only available for merchants');
    }
    const merchantId = auth.actorId;

    const body = await request.json().catch(() => null);
    const parsed = sendPhoneCodeSchema.safeParse(body);
    if (!parsed.success) {
      return validationErrorResponse(parsed.error.issues.map((i) => i.message));
    }
    // Normalize to a tight E.164-ish form for SNS (`PhoneNumber` wants no spaces).
    const phone = parsed.data.phone.replace(/\s+/g, '');

    // 60s resend cooldown — block another send while a fresh code is still warm.
    const recent = await queryOne<{ id: string }>(
      `SELECT id FROM phone_verification_codes
        WHERE merchant_id = $1
          AND consumed_at IS NULL
          AND created_at > NOW() - INTERVAL '60 seconds'
        ORDER BY created_at DESC
        LIMIT 1`,
      [merchantId]
    );
    if (recent) {
      return errorResponse('Please wait a minute before requesting another code', 429);
    }

    // Invalidate any prior outstanding codes so only the newest can verify.
    await query(
      `UPDATE phone_verification_codes SET consumed_at = NOW()
        WHERE merchant_id = $1 AND consumed_at IS NULL`,
      [merchantId]
    );

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    await query(
      `INSERT INTO phone_verification_codes (merchant_id, phone, code_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes')`,
      [merchantId, phone, codeHash]
    );

    if (isSmsConfigured()) {
      // Fire-and-forget: the merchant gets a generic success regardless of
      // MSG91 latency, exactly like the email resend route.
      sendOtpSms({ phoneNumber: phone, code }).catch((err) =>
        console.error('[Phone Verify] SMS send failed:', err)
      );
    } else if (process.env.NODE_ENV !== 'production') {
      // Dev convenience only — never leak the OTP in a production log.
      console.warn(`[Phone Verify] MSG91 not configured — dev OTP for ${phone}: ${code}`);
    }

    return successResponse({ sent: true });
  } catch (error) {
    console.error('[Phone Verify send-code] error:', error);
    return errorResponse('Failed to send verification code');
  }
}
