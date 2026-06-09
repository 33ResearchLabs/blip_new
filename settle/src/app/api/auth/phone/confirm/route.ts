import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTokenAuth, validationErrorResponse, errorResponse, successResponse } from '@/lib/middleware/auth';
import { checkRateLimit, AUTH_LIMIT } from '@/lib/middleware/rateLimit';
import { query as dbQuery } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const schema = z.object({
  firebase_token: z.string().min(1),
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/),
});

async function getFirebaseAdmin() {
  const admin = await import('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  return admin;
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = await checkRateLimit(request, 'phone:confirm', AUTH_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  const auth = await requireTokenAuth(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error.errors.map(e => e.message));
  }

  const { firebase_token, phone } = parsed.data;
  const userId = auth.actorId;

  try {
    const admin = await getFirebaseAdmin();
    const decoded = await admin.auth().verifyIdToken(firebase_token);

    // Firebase confirms the phone number in the token
    if (!decoded.phone_number || decoded.phone_number !== phone) {
      return NextResponse.json(
        { success: false, error: 'PHONE_MISMATCH', message: 'Token phone does not match.' },
        { status: 400 }
      );
    }

    // Check not already taken by another account
    const existing = await dbQuery<{ id: string }>(
      'SELECT id FROM users WHERE phone = $1 AND id != $2',
      [phone, userId]
    );
    if (existing.length > 0) {
      return NextResponse.json(
        { success: false, error: 'PHONE_TAKEN', message: 'This number is linked to another account.' },
        { status: 409 }
      );
    }

    await dbQuery(
      'UPDATE users SET phone = $1, phone_verified = TRUE WHERE id = $2',
      [phone, userId]
    );

    logger.info('[Phone] Firebase verified', { userId });
    return successResponse({ phone_verified: true });
  } catch (err) {
    const e = err as any;
    logger.error('[Phone] Firebase verify failed', { error: e.message });
    return errorResponse('Verification failed. Please try again.');
  }
}
