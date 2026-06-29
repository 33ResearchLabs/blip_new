// GET   /api/merchant/onboarding-intent  — read the merchant's saved intent
// PATCH /api/merchant/onboarding-intent  — update country / corridors /
//        payment methods / monthly commit volume on the merchant's OWN row.
//
// Powers the "Join Merchant On Board Program" card dropdowns on the waitlist
// dashboard. Merchant-authed: each merchant edits only its own row
// (WHERE id = auth.actorId). All fields are optional — only the keys present
// in the PATCH body are written, so the card can save one dropdown at a time
// without nulling the others.
//
// Storage maps to existing merchants columns (no migration):
//   country_code                  ← Choose Country
//   trade_corridors          text[] ← Corridors
//   intended_payment_methods text[] ← Payment Methods
//   expected_monthly_volume_usd   ← Commit Volume (bucket → representative USD)

import { NextRequest, NextResponse } from 'next/server';
import {
  requireAuth,
  forbiddenResponse,
  errorResponse,
  successResponse,
} from '@/lib/middleware/auth';
import { query } from '@/lib/db';
import {
  sanitizeCorridorIds,
  sanitizePaymentMethodValues,
  sanitizeCountryCode,
  volumeBucketToUsd,
  volumeUsdToBucket,
} from '@/lib/waitlist/onboardingOptions';
import { checkRateLimit, STANDARD_LIMIT } from '@/lib/middleware/rateLimit';

interface IntentRow {
  country_code: string | null;
  trade_corridors: string[] | null;
  intended_payment_methods: string[] | null;
  expected_monthly_volume_usd: number | null;
}

const SELECT_COLS =
  'country_code, trade_corridors, intended_payment_methods, expected_monthly_volume_usd';

// Normalize a row into the response the dashboard card consumes. Arrays are
// never null on the wire (empty array reads cleaner in the UI), and the
// stored USD figure is reverse-mapped to the bucket id the dropdown selects.
function shape(row: IntentRow) {
  return {
    country_code: row.country_code,
    trade_corridors: row.trade_corridors ?? [],
    intended_payment_methods: row.intended_payment_methods ?? [],
    expected_monthly_volume_usd: row.expected_monthly_volume_usd,
    commit_volume_bucket: volumeUsdToBucket(row.expected_monthly_volume_usd),
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'merchant') {
    return forbiddenResponse('Only merchant accounts have onboarding intent');
  }

  const rows = await query<IntentRow>(
    `SELECT ${SELECT_COLS} FROM merchants WHERE id = $1`,
    [auth.actorId],
  );
  if (!rows[0]) return errorResponse('Merchant not found', 404);
  return successResponse(shape(rows[0]));
}

export async function PATCH(request: NextRequest) {
  const rl = await checkRateLimit(request, 'merchant:onboarding-intent', STANDARD_LIMIT);
  if (rl) return rl;

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'merchant') {
    return forbiddenResponse('Only merchant accounts can update onboarding intent');
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  // Build the SET clause from only the keys actually present, so the card can
  // save partially. Each value is run through the shared sanitizers, so an
  // unknown / empty selection collapses to NULL (admin then shows "—").
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if ('country_code' in body) {
    sets.push(`country_code = $${i++}`);
    params.push(sanitizeCountryCode(body.country_code));
  }
  if ('trade_corridors' in body) {
    sets.push(`trade_corridors = $${i++}`);
    params.push(sanitizeCorridorIds(body.trade_corridors));
  }
  if ('intended_payment_methods' in body) {
    sets.push(`intended_payment_methods = $${i++}`);
    params.push(sanitizePaymentMethodValues(body.intended_payment_methods));
  }
  // Volume arrives as a bucket id (e.g. '10k_50k'); persist the mapped USD.
  if ('commit_volume_bucket' in body) {
    sets.push(`expected_monthly_volume_usd = $${i++}`);
    params.push(volumeBucketToUsd(body.commit_volume_bucket));
  }

  if (sets.length === 0) {
    return errorResponse('No recognized fields to update', 400);
  }

  params.push(auth.actorId);
  const rows = await query<IntentRow>(
    `UPDATE merchants SET ${sets.join(', ')}
       WHERE id = $${i}
       RETURNING ${SELECT_COLS}`,
    params,
  );
  if (!rows[0]) return errorResponse('Merchant not found', 404);
  return successResponse(shape(rows[0]));
}
