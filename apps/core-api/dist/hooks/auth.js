import { createHmac, timingSafeEqual } from 'crypto';
export const authHook = async (fastify) => {
    const secret = process.env.CORE_API_SECRET;
    if (!secret) {
        fastify.log.warn('[Auth] CORE_API_SECRET not set -- auth disabled');
        return;
    }
    fastify.addHook('onRequest', async (request, reply) => {
        // Health + debug endpoints are always public (debug has own NODE_ENV guard)
        if (request.url === '/health' || request.url.startsWith('/debug'))
            return;
        // 1. Verify shared secret
        const provided = request.headers['x-core-api-secret'];
        if (provided !== secret) {
            return reply.status(401).send({
                success: false,
                error: 'Unauthorized: invalid or missing x-core-api-secret',
            });
        }
        // 2. Verify HMAC-signed actor headers (if present)
        const actorType = request.headers['x-actor-type'];
        const actorId = request.headers['x-actor-id'];
        const actorSignature = request.headers['x-actor-signature'];
        if (actorType && actorId) {
            if (!actorSignature) {
                return reply.status(401).send({
                    success: false,
                    error: 'Unauthorized: missing actor signature',
                });
            }
            const expected = createHmac('sha256', secret)
                .update(`${actorType}:${actorId}`)
                .digest('hex');
            const expectedBuf = Buffer.from(expected, 'hex');
            const providedBuf = Buffer.from(actorSignature, 'hex');
            if (expectedBuf.length !== providedBuf.length ||
                !timingSafeEqual(expectedBuf, providedBuf)) {
                return reply.status(401).send({
                    success: false,
                    error: 'Unauthorized: invalid actor signature',
                });
            }
        }
    });
};
