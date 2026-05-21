// POST /api/waitlist/upgrade-to-user
//
// Symmetric to upgrade-to-merchant. Logged-in merchant adds the user waitlist.
// Reuses email + password_hash + wallet — no new credentials, no email
// re-verification, no extra form fields needed.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, forbiddenResponse, errorResponse } from '@/lib/middleware/auth';
import { queryOne, transaction } from '@/lib/db';
import { setupWaitlistForActor } from '@/lib/waitlist/signup';
import { defaultAvatarUrl } from '@/lib/avatars';
import { MOCK_MODE, MOCK_INITIAL_BALANCE } from '@/lib/config/mockMode';
import { checkRateLimit, STANDARD_LIMIT } from '@/lib/middleware/rateLimit';

interface MerchantSourceRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  wallet_address: string | null;
  business_name: string;
  display_name: string;
}

export async function POST(request: NextRequest) {
  const rl = await checkRateLimit(request, 'waitlist:upgrade', STANDARD_LIMIT);
  if (rl) return rl;

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  if (auth.actorType !== 'merchant') {
    return forbiddenResponse('Only merchant accounts can upgrade to user');
  }

  const sourceMerchant = await queryOne<MerchantSourceRow>(
    `SELECT id, email, password_hash, wallet_address, business_name, display_name
       FROM merchants WHERE id = $1`,
    [auth.actorId],
  );
  if (!sourceMerchant) return errorResponse('Merchant account not found', 404);
  if (!sourceMerchant.email) {
    return errorResponse('Add an email to your account before upgrading', 400);
  }

  // Idempotent: existing user for this email/wallet → no-op return.
  const emailLower = sourceMerchant.email.toLowerCase();
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM users
      WHERE LOWER(email) = $1
         OR (wallet_address IS NOT NULL AND wallet_address = $2)
      LIMIT 1`,
    [emailLower, sourceMerchant.wallet_address],
  );
  if (existing) {
    return NextResponse.json({
      success: true,
      data: {
        user_id: existing.id,
        already_existed: true,
        message: 'User waitlist signup already exists for this account',
      },
    });
  }

  const username = sourceMerchant.display_name.slice(0, 50);
  const name = sourceMerchant.business_name.slice(0, 100);
  const initBalance = MOCK_MODE ? MOCK_INITIAL_BALANCE : 0;

  let userId: string;
  try {
    const insertResult = await transaction(async (client) => {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO users (
            email, password_hash, wallet_address, name, username,
            balance, email_verified, avatar_url
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id`,
        [
          sourceMerchant.email,
          sourceMerchant.password_hash,
          sourceMerchant.wallet_address,
          name,
          username,
          initBalance,
          true,
          defaultAvatarUrl(sourceMerchant.email),
        ],
      );
      return ins.rows[0];
    });
    userId = insertResult.id;
  } catch (err) {
    console.error('[waitlist/upgrade-to-user] insert failed', err);
    return errorResponse('Failed to create user waitlist entry', 500);
  }

  try {
    const setup = await setupWaitlistForActor({
      actorId: userId,
      actorType: 'user',
      source: 'upgrade_from_merchant',
    });
    return NextResponse.json({
      success: true,
      data: {
        user_id: userId,
        referral_code: setup.referralCode,
        blip_points_credited: setup.registerCredited,
        user_total_points: setup.totalPoints,
      },
    });
  } catch (err) {
    console.error('[waitlist/upgrade-to-user] setup failed', err);
    return NextResponse.json({
      success: true,
      data: {
        user_id: userId,
        warning: 'User created but waitlist setup partially failed; refresh to retry.',
      },
    });
  }
}
