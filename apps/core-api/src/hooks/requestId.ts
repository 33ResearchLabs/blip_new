/**
 * Request ID Utilities
 *
 * genReqId: Reads x-request-id from incoming headers (forwarded by settle proxy).
 * If missing, generates a UUID. Used as Fastify's genReqId option.
 * The ID is then available as request.id in all route handlers.
 *
 * registerRequestIdHeader: Registers an onSend hook that echoes request.id
 * back as an x-request-id response header.
 */
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';

/**
 * Fastify genReqId function. Pass to Fastify constructor options.
 * Reads x-request-id from incoming headers; generates a UUID if missing.
 */
export function genReqId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const incoming = req.headers['x-request-id'];
  if (typeof incoming === 'string' && incoming.length > 0) {
    return incoming;
  }
  return randomUUID();
}

/**
 * Register an onSend hook that echoes request.id as x-request-id response header.
 * Must be called directly on the Fastify instance (not inside a plugin) to avoid
 * encapsulation scoping.
 */
export function registerRequestIdHeader(fastify: FastifyInstance): void {
  fastify.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
}
