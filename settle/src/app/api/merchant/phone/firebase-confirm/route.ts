/**
 * POST /api/merchant/phone/firebase-confirm
 *
 * Firebase-backed phone verification for the MERCHANT actor — the merchant
 * equivalent of /api/auth/phone/confirm (which only ever touches the `users`
 * table). The client verifies the OTP with Firebase, then posts the resulting
 * Firebase ID token here; we verify the token server-side and promote the
 * number to the merchant's verified phone.
 *
 * Writes the same columns the "Verified" badge logic reads
 * (phone, phone_verified, phone_verified_at).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  requireAuth,
  errorResponse,
  successResponse,
  validationErrorResponse,
  forbiddenResponse,
} from '@/lib/middleware/auth';
import { checkRateLimit, AUTH_LIMIT } from '@/lib/middleware/rateLimit';
import { queryOne, query } from '@/lib/db';
import { invalidateMerchantCache } from '@/lib/cache';
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
  const rl = await checkRateLimit(request, 'merchant:phone:firebase-confirm', AUTH_LIMIT);
  if (rl) return rl;

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'merchant') {
    return forbiddenResponse('Phone verification is only available for merchants');
  }
  const merchantId = auth.actorId;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error.issues.map((i) => i.message));
  }
  const { firebase_token, phone } = parsed.data;

  try {
    const admin = await getFirebaseAdmin();
    const decoded = await admin.auth().verifyIdToken(firebase_token);

    // Firebase asserts the verified number inside the signed token.
    if (!decoded.phone_number || decoded.phone_number !== phone) {
      return NextResponse.json(
        { success: false, error: 'PHONE_MISMATCH', message: 'Token phone does not match.' },
        { status: 400 }
      );
    }

    // Block linking a number that already belongs to a different merchant.
    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM merchants WHERE phone = $1 AND id != $2',
      [phone, merchantId]
    );
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'PHONE_TAKEN', message: 'This number is linked to another account.' },
        { status: 409 }
      );
    }

    await query(
      `UPDATE merchants
          SET phone = $1, phone_verified = true, phone_verified_at = NOW(), updated_at = NOW()
        WHERE id = $2`,
      [phone, merchantId]
    );
    invalidateMerchantCache(merchantId);

    logger.info('[Phone] Firebase verified (merchant)', { merchantId });
    return successResponse({ phone, phone_verified: true });
  } catch (err) {
    const e = err as Error;
    logger.error('[Phone] Firebase merchant verify failed', { error: e.message });
    return errorResponse('Verification failed. Please try again.');
  }
}
