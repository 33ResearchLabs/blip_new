/**
 * /api/limits/x-verification
 *
 *   GET  — the authenticated actor's X (Twitter) verification, or null.
 *   POST — record the actor's X handle as verified (self-attested).
 *
 * Surfaced in the merchant Settings → Limits tab as a "Social Verification"
 * task. This is DISPLAY-ONLY: it does NOT change trade limits and is
 * independent of the waitlist quest system. Self-attested for now (we trust
 * the merchant's handle), mirroring the waitlist follow flow — the handle is
 * stored so it can be audited later. One row per actor (upsert).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  requireAuth,
  successResponse,
  validationErrorResponse,
  forbiddenResponse,
} from '@/lib/middleware/auth';
import {
  getXVerification,
  upsertXVerification,
} from '@/lib/db/repositories/xAccountVerifications';
import { awardXVerified } from '@/lib/coins/awards';
import { z } from 'zod';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const actorType = auth.actorType;
  if (actorType !== 'user' && actorType !== 'merchant') {
    return forbiddenResponse('Verification only applies to user/merchant accounts');
  }

  const row = await getXVerification(actorType, auth.actorId);
  return successResponse(row);
}

const BodySchema = z.object({
  // X handle without the leading '@'. Same rule the waitlist follow quest
  // uses: 1–15 chars, letters/digits/underscore only.
  x_username: z
    .string()
    .trim()
    .transform((s) => s.replace(/^@/, ''))
    .pipe(
      z
        .string()
        .regex(
          /^[a-zA-Z0-9_]{1,15}$/,
          'Invalid X username. Enter your handle without @.',
        ),
    ),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const actorType = auth.actorType;
  if (actorType !== 'user' && actorType !== 'merchant') {
    return forbiddenResponse('Verification only applies to user/merchant accounts');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return validationErrorResponse(['Invalid JSON body']);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error.issues.map((i) => i.message));
  }

  const row = await upsertXVerification(
    actorType,
    auth.actorId,
    parsed.data.x_username,
  );

  // One-time Blip Points bonus for verifying X. Lifetime-capped (sourceRef
  // 'x_verification'), so re-verifying / changing the handle never re-credits.
  // Guarded — a coin-award hiccup must never fail the verification itself.
  try {
    await awardXVerified({ actorId: auth.actorId, actorType });
  } catch (err) {
    console.error('[x-verification] award failed (non-fatal):', err);
  }

  return successResponse(row);
}
