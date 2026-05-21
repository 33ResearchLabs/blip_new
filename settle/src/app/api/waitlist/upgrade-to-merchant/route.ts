// POST /api/waitlist/upgrade-to-merchant
//
// Logged-in waitlist user adds the merchant waitlist on top of their existing
// user account. Reuses their email + password_hash + wallet_address — no
// new credentials, no email re-verification. Collects business fields
// (business_name, business_category, expected_monthly_volume_usd, country_code).
//
// Idempotent: a second call returns the existing merchant row instead of
// creating a duplicate.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, forbiddenResponse, errorResponse } from '@/lib/middleware/auth';
import { queryOne, transaction } from '@/lib/db';
import { setupWaitlistForActor } from '@/lib/waitlist/signup';
import { defaultAvatarUrl } from '@/lib/avatars';
import { MOCK_MODE, MOCK_INITIAL_BALANCE } from '@/lib/config/mockMode';
import { checkRateLimit, STANDARD_LIMIT } from '@/lib/middleware/rateLimit';

interface UserSourceRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  wallet_address: string | null;
  name: string | null;
  waitlist_status: 'waitlisted' | 'active' | 'rejected';
}

export async function POST(request: NextRequest) {
  const rl = await checkRateLimit(request, 'waitlist:upgrade', STANDARD_LIMIT);
  if (rl) return rl;

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  if (auth.actorType !== 'user') {
    return forbiddenResponse('Only user accounts can upgrade to merchant');
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const businessName = typeof body.business_name === 'string' ? body.business_name.trim() : '';
  if (!businessName) {
    return errorResponse('business_name is required', 400);
  }
  if (businessName.length > 100) {
    return errorResponse('business_name too long (max 100)', 400);
  }

  const businessCategory = typeof body.business_category === 'string' ? body.business_category.trim().slice(0, 100) : null;
  const expectedVolume = typeof body.expected_monthly_volume_usd === 'number' && Number.isFinite(body.expected_monthly_volume_usd)
    ? body.expected_monthly_volume_usd
    : null;
  const countryCode = typeof body.country_code === 'string' ? body.country_code.trim().toUpperCase().slice(0, 8) : null;

  // Source user row (we'll copy email + password_hash + wallet from here).
  const sourceUser = await queryOne<UserSourceRow>(
    `SELECT id, email, password_hash, wallet_address, name, waitlist_status
       FROM users WHERE id = $1`,
    [auth.actorId],
  );
  if (!sourceUser) {
    return errorResponse('User account not found', 404);
  }
  if (!sourceUser.email) {
    return errorResponse('Add an email to your account before upgrading', 400);
  }

  // Guard 1: if a merchant row already exists for this email or wallet, this
  // is a no-op. Return the existing row (idempotent retries).
  const emailLower = sourceUser.email.toLowerCase();
  const existing = await queryOne<{ id: string; waitlist_status: string }>(
    `SELECT id, waitlist_status FROM merchants
      WHERE LOWER(email) = $1
         OR (wallet_address IS NOT NULL AND wallet_address = $2)
      LIMIT 1`,
    [emailLower, sourceUser.wallet_address],
  );
  if (existing) {
    return NextResponse.json({
      success: true,
      data: {
        merchant_id: existing.id,
        already_existed: true,
        message: 'Merchant waitlist signup already exists for this account',
      },
    });
  }

  const displayName = businessName.slice(0, 50);
  const initBalance = MOCK_MODE ? MOCK_INITIAL_BALANCE : 0;

  // Single transaction: insert merchant row, then run setup. The setup
  // helper handles its own transaction internally — that's fine, both
  // commit before returning, so the dashboard read sees a consistent view.
  let merchantId: string;
  try {
    const insertResult = await transaction(async (client) => {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO merchants (
            email, password_hash, business_name, display_name,
            status, is_online, balance, email_verified, avatar_url,
            wallet_address, business_category, expected_monthly_volume_usd, country_code
          ) VALUES ($1, $2, $3, $4, 'active', false, $5, $6, $7, $8, $9, $10, $11)
          RETURNING id`,
        [
          sourceUser.email,
          sourceUser.password_hash,
          businessName,
          displayName,
          initBalance,
          true, // email already verified on user side
          defaultAvatarUrl(sourceUser.email),
          sourceUser.wallet_address,
          businessCategory,
          expectedVolume,
          countryCode,
        ],
      );
      return ins.rows[0];
    });
    merchantId = insertResult.id;
  } catch (err) {
    console.error('[waitlist/upgrade-to-merchant] insert failed', err);
    return errorResponse('Failed to create merchant waitlist entry', 500);
  }

  // Activate the new merchant row on the waitlist (credits MERCHANT_REGISTER points).
  try {
    const setup = await setupWaitlistForActor({
      actorId: merchantId,
      actorType: 'merchant',
      source: 'upgrade_from_user',
    });
    return NextResponse.json({
      success: true,
      data: {
        merchant_id: merchantId,
        referral_code: setup.referralCode,
        blip_points_credited: setup.registerCredited,
        merchant_total_points: setup.totalPoints,
      },
    });
  } catch (err) {
    console.error('[waitlist/upgrade-to-merchant] setup failed', err);
    // Row exists; surface the partial success.
    return NextResponse.json({
      success: true,
      data: {
        merchant_id: merchantId,
        warning: 'Merchant created but waitlist setup partially failed; refresh to retry.',
      },
    });
  }
}
