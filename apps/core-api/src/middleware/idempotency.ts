/**
 * Server-Side Idempotency Middleware
 *
 * Prevents duplicate mutations from retries/double-submits.
 * Uses DB-backed dedup via the idempotency_keys table.
 *
 * Two exports:
 *   idempotencyGuard(routeKey, getOrderId?) — Fastify preHandler factory
 *   registerIdempotencyCapture(fastify)     — global onSend hook to store responses
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { query, queryOne } from 'settlement-core';

// ─── Fastify type augmentation ───────────────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    idempotencyMeta?: { key: string };
  }
}

// ─── Types ───────────────────────────────────────────────────────

interface IdempotencyRow {
  key: string;
  route: string;
  order_id: string | null;
  request_hash: string | null;
  status: 'in_progress' | 'completed' | 'failed';
  response_code: number | null;
  response_json: unknown;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────

function computeRequestHash(request: FastifyRequest): string {
  const data = `${request.method}:${request.url}:${JSON.stringify(request.body || {})}`;
  return createHash('sha256').update(data).digest('hex');
}

// ─── preHandler factory ──────────────────────────────────────────

/**
 * Creates a Fastify preHandler that enforces idempotency.
 *
 * @param routeKey  Logical route name (e.g. 'orders.transition')
 * @param getOrderId  Optional extractor for order_id from the request
 */
export function idempotencyGuard(
  routeKey: string,
  getOrderId?: (req: FastifyRequest) => string | null
) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const key = request.headers['idempotency-key'] as string | undefined;

    if (!key) {
      return reply.status(400).send({
        success: false,
        error: 'Missing Idempotency-Key header',
      });
    }

    const orderId = getOrderId ? getOrderId(request) : null;
    const requestHash = computeRequestHash(request);

    // Try to claim the key
    const inserted = await queryOne<{ key: string }>(
      `INSERT INTO idempotency_keys (key, route, order_id, request_hash, status, expires_at)
       VALUES ($1, $2, $3, $4, 'in_progress', NOW() + INTERVAL '7 days')
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
      [key, routeKey, orderId, requestHash]
    );

    if (inserted) {
      // New key — proceed to handler
      request.idempotencyMeta = { key };
      return;
    }

    // Key already exists — check status
    const existing = await queryOne<IdempotencyRow>(
      `SELECT * FROM idempotency_keys WHERE key = $1`,
      [key]
    );

    if (!existing) {
      // Race: deleted between INSERT and SELECT — proceed without dedup
      return;
    }

    if (existing.status === 'completed') {
      // Reject key reuse with different request body
      if (existing.request_hash && existing.request_hash !== requestHash) {
        return reply.status(409).send({
          success: false,
          error: 'Idempotency key reuse with different request',
        });
      }
      reply.header('Idempotency-Replay', 'true');
      return reply.status(existing.response_code || 200).send(existing.response_json);
    }

    if (existing.status === 'in_progress') {
      return reply.status(409).send({
        success: false,
        error: 'Request already in progress',
      });
    }

    // status === 'failed'
    if (existing.request_hash !== requestHash) {
      return reply.status(409).send({
        success: false,
        error: 'Idempotency key reuse with different request',
      });
    }

    // Failed with same hash — allow retry
    await query(
      `UPDATE idempotency_keys SET status = 'in_progress', updated_at = NOW() WHERE key = $1`,
      [key]
    );
    request.idempotencyMeta = { key };
  };
}

// ─── onSend hook (response capture) ──────────────────────────────

/**
 * Registers a global onSend hook that stores the response for
 * idempotent requests, enabling future replays.
 */
export function registerIdempotencyCapture(fastify: FastifyInstance) {
  fastify.addHook('onSend', async (request, _reply, payload) => {
    const meta = request.idempotencyMeta;
    if (!meta) return payload;

    const code = _reply.statusCode;
    const status = code >= 500 ? 'failed' : 'completed';

    // Parse payload to store as JSONB
    let jsonPayload: unknown = null;
    if (typeof payload === 'string') {
      try {
        jsonPayload = JSON.parse(payload);
      } catch {
        jsonPayload = payload;
      }
    } else {
      jsonPayload = payload;
    }

    await query(
      `UPDATE idempotency_keys
         SET status = $1, response_code = $2, response_json = $3, updated_at = NOW()
       WHERE key = $4`,
      [status, code, JSON.stringify(jsonPayload), meta.key]
    ).catch(() => {
      // Fire-and-forget — don't fail the request if capture fails
    });

    return payload;
  });
}
