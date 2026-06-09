import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTokenAuth, validationErrorResponse } from '@/lib/middleware/auth';
import { checkRateLimit, STRICT_LIMIT } from '@/lib/middleware/rateLimit';
import { createPhoneAssessment } from '@/lib/recaptcha';

export const dynamic = 'force-dynamic';

const schema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/),
  recaptcha_token: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const rateLimitResponse = await checkRateLimit(request, 'phone:assess', STRICT_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  const auth = await requireTokenAuth(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error.errors.map(e => e.message));

  const { phone, recaptcha_token } = parsed.data;
  const assessment = await createPhoneAssessment(recaptcha_token, phone, auth.actorId);

  if (!assessment.allowed) {
    return NextResponse.json(
      { success: false, error: 'RECAPTCHA_BLOCKED', message: 'Request blocked. Please try again later.' },
      { status: 429 }
    );
  }

  return NextResponse.json({ success: true, assessmentId: assessment.assessmentId });
}
