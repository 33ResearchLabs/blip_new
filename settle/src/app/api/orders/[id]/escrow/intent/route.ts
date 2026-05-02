/**
 * POST /api/orders/[id]/escrow/intent
 *
 * Client calls this BEFORE opening the wallet popup. We record the
 * upcoming on-chain lock as a `pending_escrow` row tied to (order_id,
 * actor_wallet, trade_id). From this point forward the escrow-reconciler
 * worker is responsible for reconciling on-chain reality into the
 * orders table — even if the client closes the tab, drops the network,
 * or misinterprets a slow confirmation as a failure.
 *
 * Idempotent: same Idempotency-Key returns the same row.
 *
 * Body:
 *   { trade_id: number, expected_amount: number, actor_wallet: string,
 *     reported_signature?: string }   (signature is filled in later if known)
 *
 * Returns:
 *   { pending_id, trade_id, status, timeout_at }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  requireAuth,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { checkRateLimit, ORDER_LIMIT } from '@/lib/middleware/rateLimit';
import { uuidSchema } from '@/lib/validation/schemas';
import { getOrderById } from '@/lib/db/repositories/orders';
import { getIdempotencyKey } from '@/lib/idempotency';
import { query } from '@/lib/db';

const intentSchema = z.object({
  // Solana trade ID — the value the client will pass to findTradePda when
  // building the on-chain instruction. We store it so the reconciler can
  // derive the same PDA without needing the signature.
  trade_id: z.union([z.string(), z.number()]).transform((v) => {
    const n = typeof v === 'string' ? Number(v) : v;
    if (!Number.isFinite(n) || n <= 0) throw new Error('invalid trade_id');
    // Mirror the BigInt range used by the on-chain program (u64).
    return BigInt(Math.floor(n)).toString();
  }),
  expected_amount: z.number().positive('expected_amount must be > 0'),
  actor_wallet: z
    .string()
    .min(32, 'actor_wallet too short')
    .max(64, 'actor_wallet too long')
    .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'actor_wallet must be base58'),
  reported_signature: z
    .string()
    .min(87)
    .max(88)
    .regex(/^[1-9A-HJ-NP-Za-km-z]+$/)
    .optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rl = await checkRateLimit(request, 'escrow:intent', ORDER_LIMIT);
  if (rl) return rl;

  const { id: orderId } = await params;
  const idCheck = uuidSchema.safeParse(orderId);
  if (!idCheck.success) {
    return validationErrorResponse(['Invalid order id']);
  }

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'merchant' && auth.actorType !== 'user') {
    return forbiddenResponse('Only user/merchant actors can lock escrow');
  }

  let body: z.infer<typeof intentSchema>;
  try {
    body = intentSchema.parse(await request.json());
  } catch (err) {
    return validationErrorResponse(
      err instanceof z.ZodError
        ? err.errors.map((e) => `${e.path.join('.')}: ${e.message}`)
        : ['Invalid request body'],
    );
  }

  // Order must exist + actor must be participant. We don't enforce a
  // specific status — the worker tolerates any pending/accepted state and
  // the client may legitimately register intent before the order has
  // fully transitioned (race-resistant).
  const order = await getOrderById(orderId);
  if (!order) return notFoundResponse('Order');
  const isParticipant =
    order.user_id === auth.actorId ||
    order.merchant_id === auth.actorId ||
    order.buyer_merchant_id === auth.actorId;
  if (!isParticipant) {
    return forbiddenResponse('You are not a participant in this order');
  }

  const idemKey = getIdempotencyKey(request);

  try {
    // Insert OR return the existing in-flight row. There's a partial
    // unique index on order_id WHERE resolved_at IS NULL, so a concurrent
    // double-click on Lock can't open two intents for the same order.
    // Same Idempotency-Key on retry returns the same row.
    const result = await query<{
      id: string;
      trade_id: string;
      status: string;
      timeout_at: string;
      created_existed: boolean;
    }>(
      `WITH ins AS (
         INSERT INTO pending_escrow (
           order_id, merchant_id, user_id, actor_type, actor_wallet,
           trade_id, expected_amount, reported_signature, idempotency_key
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
           DO NOTHING
         RETURNING id, trade_id::text AS trade_id, status, timeout_at,
                   FALSE AS created_existed
       ),
       existing AS (
         -- If the INSERT was skipped by ON CONFLICT, fetch the existing row.
         SELECT id, trade_id::text AS trade_id, status, timeout_at,
                TRUE AS created_existed
           FROM pending_escrow
          WHERE idempotency_key = $9
            AND $9 IS NOT NULL
       ),
       inflight AS (
         -- Or, if no idempotency key, see if there's already an in-flight
         -- row for this order (the partial unique index would block a 2nd insert).
         SELECT id, trade_id::text AS trade_id, status, timeout_at,
                TRUE AS created_existed
           FROM pending_escrow
          WHERE order_id = $1
            AND resolved_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1
       )
       SELECT * FROM ins
       UNION ALL
       SELECT * FROM existing WHERE NOT EXISTS (SELECT 1 FROM ins)
       UNION ALL
       SELECT * FROM inflight WHERE NOT EXISTS (SELECT 1 FROM ins)
                                AND NOT EXISTS (SELECT 1 FROM existing)
       LIMIT 1;`,
      [
        orderId,
        auth.actorType === 'merchant' ? auth.actorId : null,
        auth.actorType === 'user' ? auth.actorId : null,
        auth.actorType,
        body.actor_wallet,
        body.trade_id,
        body.expected_amount,
        body.reported_signature ?? null,
        idemKey ?? null,
      ],
    );

    const row = result[0];
    if (!row) {
      return errorResponse('Failed to register escrow intent');
    }

    return successResponse({
      pending_id: row.id,
      trade_id: row.trade_id,
      status: row.status,
      timeout_at: row.timeout_at,
      reused: row.created_existed,
    });
  } catch (err) {
    // 23505 = unique_violation. Most likely the partial-unique index on
    // (order_id WHERE resolved_at IS NULL) fired because two concurrent
    // intent calls both raced past the SELECT-existing fallback. Refetch
    // the winning row instead of erroring — same UX as the idempotent path.
    const code = (err as { code?: string }).code;
    if (code === '23505') {
      const refetch = await query<{
        id: string;
        trade_id: string;
        status: string;
        timeout_at: string;
      }>(
        `SELECT id, trade_id::text AS trade_id, status, timeout_at
           FROM pending_escrow
          WHERE order_id = $1 AND resolved_at IS NULL
          ORDER BY created_at DESC LIMIT 1`,
        [orderId],
      );
      if (refetch[0]) {
        return successResponse({
          pending_id: refetch[0].id,
          trade_id: refetch[0].trade_id,
          status: refetch[0].status,
          timeout_at: refetch[0].timeout_at,
          reused: true,
        });
      }
    }
    console.error('[escrow/intent] error:', err);
    return errorResponse('Failed to register escrow intent');
  }
}

/**
 * PATCH /api/orders/[id]/escrow/intent
 *
 * Optional follow-up: the client tells settle the on-chain signature it
 * just got back from sendRawTransaction. Speeds up the next reconciler
 * pass and gives a forensic link in case of dispute. Worker is correct
 * without it — the PDA derivation is sufficient.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rl = await checkRateLimit(request, 'escrow:intent:patch', ORDER_LIMIT);
  if (rl) return rl;

  const { id: orderId } = await params;
  const idCheck = uuidSchema.safeParse(orderId);
  if (!idCheck.success) return validationErrorResponse(['Invalid order id']);

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const sigSchema = z.object({
    pending_id: z.string().uuid(),
    reported_signature: z
      .string()
      .min(87)
      .max(88)
      .regex(/^[1-9A-HJ-NP-Za-km-z]+$/),
  });

  let body: z.infer<typeof sigSchema>;
  try {
    body = sigSchema.parse(await request.json());
  } catch (err) {
    return validationErrorResponse(
      err instanceof z.ZodError
        ? err.errors.map((e) => `${e.path.join('.')}: ${e.message}`)
        : ['Invalid request body'],
    );
  }

  // Only the actor who created the intent (and same order) may patch it.
  const result = await query(
    `UPDATE pending_escrow
        SET reported_signature = $3,
            updated_at = NOW()
      WHERE id = $1
        AND order_id = $2
        AND resolved_at IS NULL
        AND ((actor_type = 'merchant' AND merchant_id = $4)
             OR (actor_type = 'user'  AND user_id     = $4))
      RETURNING id`,
    [body.pending_id, orderId, body.reported_signature, auth.actorId],
  );
  if (result.length === 0) {
    return notFoundResponse('Pending escrow intent');
  }
  return successResponse({ ok: true });
}
