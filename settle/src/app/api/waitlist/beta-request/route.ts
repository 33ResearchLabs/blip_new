// POST /api/waitlist/beta-request — actor requests merchant beta access.
//
// Identity is taken from the auth cookie; profile fields (email,
// display_name, business_name, country_code) are snapshotted from the
// matching users/merchants row so the admin queue sees what was true at
// request time even if the actor renames themselves later.
//
// Idempotent: a re-click while a request is already in 'pending' returns
// the existing row instead of creating a duplicate. Enforced both via
// the partial unique index in migration 135 and via the SELECT-first path
// here (avoids relying on catching a 23505 just for the happy path).

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, forbiddenResponse, errorResponse } from '@/lib/middleware/auth';
import { query, queryOne } from '@/lib/db';
import { checkRateLimit, STANDARD_LIMIT } from '@/lib/middleware/rateLimit';

interface BetaRequestRow {
  id: string;
  actor_id: string;
  actor_type: 'user' | 'merchant';
  email: string | null;
  display_name: string | null;
  business_name: string | null;
  country_code: string | null;
  expected_trading_amount_usd: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'contacted';
  requested_at: string;
  reviewed_at: string | null;
}

export async function POST(request: NextRequest) {
  const rl = await checkRateLimit(request, 'waitlist:beta-request', STANDARD_LIMIT);
  if (rl) return rl;

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
    return forbiddenResponse('Beta access is only for users and merchants');
  }

  // Banner copy on the waitlist dashboard frames the request as a
  // "Merchant P2P App Test" — restrict the endpoint to merchants for now
  // so the schema and admin UX don't have to handle a half-defined user
  // flow. If we ever open it to users, drop this gate.
  if (auth.actorType !== 'merchant') {
    return forbiddenResponse('Merchant beta access — sign in as a merchant to request');
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is fine — the only optional field is expected_trading_amount_usd.
    body = {};
  }

  // Validate the merchant-declared expected monthly trading volume in USD.
  // Required for merchants. Accept a number or a numeric string; clamp to
  // a sane range so a typo / overflow can't trash the admin view. Zero is
  // rejected — if they have no plan, they shouldn't be requesting beta.
  const raw = body.expected_trading_amount_usd;
  let expectedAmount: number | null = null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    expectedAmount = raw;
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw.replace(/[^\d.]/g, ''));
    if (Number.isFinite(parsed)) expectedAmount = parsed;
  }
  if (expectedAmount === null || expectedAmount <= 0) {
    return errorResponse('Expected trading amount is required (USD, > 0)', 400);
  }
  if (expectedAmount > 1_000_000_000) {
    return errorResponse('Expected trading amount looks too high — please re-enter', 400);
  }

  // Snapshot profile fields. Email + display_name + business_name +
  // country_code come from the merchants row, not the client, so the
  // admin can trust them.
  const merchant = await queryOne<{
    email: string | null;
    display_name: string | null;
    business_name: string | null;
    country_code: string | null;
  }>(
    `SELECT email, display_name, business_name, country_code
       FROM merchants
      WHERE id = $1`,
    [auth.actorId],
  );
  if (!merchant) {
    return errorResponse('Account not found', 404);
  }

  // Short-circuit: if a pending request already exists, return it.
  const existing = await queryOne<BetaRequestRow>(
    `SELECT * FROM beta_access_requests
      WHERE actor_type = $1 AND actor_id = $2 AND status = 'pending'
      LIMIT 1`,
    [auth.actorType, auth.actorId],
  );
  if (existing) {
    return NextResponse.json({
      success: true,
      data: { request: existing, alreadyExisted: true },
    });
  }

  const inserted = await queryOne<BetaRequestRow>(
    `INSERT INTO beta_access_requests
       (actor_id, actor_type, email, display_name, business_name,
        country_code, expected_trading_amount_usd, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
     RETURNING *`,
    [
      auth.actorId,
      auth.actorType,
      merchant.email,
      merchant.display_name,
      merchant.business_name,
      merchant.country_code,
      expectedAmount,
    ],
  );

  return NextResponse.json({
    success: true,
    data: { request: inserted, alreadyExisted: false },
  });
}
