/**
 * /api/limits/requests
 *
 *   GET  — the authenticated actor's limit-increase requests, newest first.
 *   POST — open a new request to raise the daily or per-transaction limit.
 *
 * Limits are USD-denominated (see src/lib/coins/limits.ts). The "current"
 * limit is the flat base cap ($200 daily / $50 per-trade) — the same value
 * the Limits tab shows — so the history reads as base → requested. Requests
 * are reviewed out-of-band; the merchant only ever sees their own rows.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  requireAuth,
  successResponse,
  errorResponse,
  validationErrorResponse,
  forbiddenResponse,
} from '@/lib/middleware/auth';
import { query, queryOne } from '@/lib/db';
import { getEffectiveLimits } from '@/lib/coins/limits';
import { z } from 'zod';

interface LimitRequestRow {
  id: string;
  kind: 'daily' | 'per_transaction';
  current_limit_usd: string;
  requested_limit_usd: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_at: Date | null;
  created_at: Date;
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const actorType = auth.actorType;
  if (actorType !== 'user' && actorType !== 'merchant') {
    return forbiddenResponse('Limits only apply to user/merchant accounts');
  }

  const rows = await query<LimitRequestRow>(
    `SELECT id, kind, current_limit_usd, requested_limit_usd,
            reason, status, reviewed_at, created_at
       FROM limit_increase_requests
      WHERE actor_type = $1 AND actor_id = $2
   ORDER BY created_at DESC
      LIMIT 20`,
    [actorType, auth.actorId],
  );

  return successResponse(rows);
}

const BodySchema = z.object({
  kind: z.enum(['daily', 'per_transaction']),
  // Stored in USD. Cap at $1M to bound the input; the real ceiling is the
  // reviewer's discretion.
  requested_limit_usd: z.number().positive().max(1_000_000),
  reason: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const actorType = auth.actorType;
  if (actorType !== 'user' && actorType !== 'merchant') {
    return forbiddenResponse('Limits only apply to user/merchant accounts');
  }
  const actorId = auth.actorId;

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
  const { kind, requested_limit_usd, reason } = parsed.data;

  // "Current" is the actor's effective cap (base/tier × rep, raised by any
  // already-approved override) — so a follow-up request must exceed what
  // they've already been granted, not just the base.
  const effective = await getEffectiveLimits(actorId, actorType);
  const currentLimitUsd =
    kind === 'daily' ? effective.dailyUsd : effective.perTradeUsd;

  if (requested_limit_usd <= currentLimitUsd) {
    return validationErrorResponse([
      'Requested limit must be higher than your current limit',
    ]);
  }

  // One open request per kind — re-requesting while a review is pending is
  // a no-op the merchant should resolve first.
  const pending = await queryOne<{ id: string }>(
    `SELECT id FROM limit_increase_requests
      WHERE actor_type = $1 AND actor_id = $2 AND kind = $3 AND status = 'pending'
      LIMIT 1`,
    [actorType, actorId, kind],
  );
  if (pending) {
    return errorResponse(
      'You already have a pending request for this limit',
      409,
    );
  }

  const row = await queryOne<LimitRequestRow>(
    `INSERT INTO limit_increase_requests
        (actor_type, actor_id, kind, current_limit_usd, requested_limit_usd, reason)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, kind, current_limit_usd, requested_limit_usd,
               reason, status, reviewed_at, created_at`,
    [actorType, actorId, kind, currentLimitUsd, requested_limit_usd, reason ?? null],
  );

  return successResponse(row);
}
