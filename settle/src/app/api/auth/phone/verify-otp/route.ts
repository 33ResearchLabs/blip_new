import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTokenAuth, validationErrorResponse, errorResponse, successResponse } from '@/lib/middleware/auth';
import { checkRateLimit, AUTH_LIMIT } from '@/lib/middleware/rateLimit';
import { query as dbQuery } from '@/lib/db';
import { logger } from '@/lib/logger';
import { annotatePhoneAssessment } from '@/lib/recaptcha';

export const dynamic = 'force-dynamic';

const schema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/),
  code: z.string().length(6).regex(/^\d{6}$/, 'OTP must be 6 digits'),
});

export async function POST(request: NextRequest) {
  const rateLimitResponse = await checkRateLimit(request, 'phone:verify-otp', AUTH_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  const auth = await requireTokenAuth(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error.errors.map(e => e.message));
  }

  const { phone, code } = parsed.data;
  const userId = auth.actorId;

  // Fetch latest unused, unexpired OTP for this user+phone
  const rows = await dbQuery<{
    id: string; code: string; attempts: number; expires_at: string; assessment_id: string | null;
  }>(
    `SELECT id, code, attempts, expires_at, assessment_id FROM phone_otp_codes
     WHERE user_id = $1 AND phone = $2 AND used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [userId, phone]
  );

  if (!rows[0]) {
    return NextResponse.json(
      { success: false, error: 'OTP_EXPIRED', message: 'Code expired or not found. Please request a new one.' },
      { status: 400 }
    );
  }

  const otp = rows[0];

  // Max 5 attempts before invalidating
  if (otp.attempts >= 5) {
    await dbQuery('UPDATE phone_otp_codes SET used = TRUE WHERE id = $1', [otp.id]);
    if (otp.assessment_id) {
      void annotatePhoneAssessment({
        assessmentId: otp.assessment_id,
        phone,
        reason: 'FAILED_TWO_FACTOR',
        annotation: 'FRAUDULENT',
      });
    }
    return NextResponse.json(
      { success: false, error: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts. Please request a new code.' },
      { status: 400 }
    );
  }

  if (otp.code !== code) {
    await dbQuery('UPDATE phone_otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
    const remaining = 5 - (otp.attempts + 1);
    if (otp.assessment_id) {
      void annotatePhoneAssessment({
        assessmentId: otp.assessment_id,
        phone,
        reason: 'FAILED_TWO_FACTOR',
      });
    }
    return NextResponse.json(
      { success: false, error: 'INVALID_OTP', message: `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} left.` },
      { status: 400 }
    );
  }

  // Mark used + verify the user's phone
  await dbQuery('UPDATE phone_otp_codes SET used = TRUE WHERE id = $1', [otp.id]);
  await dbQuery('UPDATE users SET phone_verified = TRUE WHERE id = $1', [userId]);

  // Annotate: OTP successfully verified
  if (otp.assessment_id) {
    void annotatePhoneAssessment({
      assessmentId: otp.assessment_id,
      phone,
      reason: 'PASSED_TWO_FACTOR',
      annotation: 'LEGITIMATE',
    });
  }

  logger.info('[Phone] Verified', { userId });
  return successResponse({ phone_verified: true });
}
