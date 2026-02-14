import { query } from 'settlement-core';
import { getWsStats } from '../ws/broadcast';
import { readFileSync } from 'fs';
export const debugRoutes = async (fastify) => {
    // Block in production — return 404 to hide existence
    fastify.addHook('onRequest', async (_request, reply) => {
        if (process.env.NODE_ENV === 'production') {
            return reply.status(404).send({ error: 'Not found' });
        }
    });
    // GET /debug/ws — connected clients, subscriptions
    fastify.get('/debug/ws', async () => {
        return getWsStats();
    });
    // GET /debug/workers — last heartbeat from each worker process
    fastify.get('/debug/workers', async () => {
        const readHeartbeat = (name) => {
            try {
                return JSON.parse(readFileSync(`/tmp/bm-worker-${name}.json`, 'utf-8'));
            }
            catch {
                return { status: 'not running or no heartbeat file' };
            }
        };
        return {
            outbox: readHeartbeat('outbox'),
            expiry: readHeartbeat('expiry'),
        };
    });
    // GET /debug/outbox?status=pending&limit=50
    fastify.get('/debug/outbox', async (request) => {
        const status = request.query.status || 'pending';
        const limit = Math.min(parseInt(request.query.limit || '50', 10), 200);
        const rows = await query(`SELECT id, order_id, event_type, status, attempts, max_attempts,
              created_at, last_attempt_at, sent_at, last_error
       FROM notification_outbox
       WHERE status = $1
       ORDER BY created_at DESC
       LIMIT $2`, [status, limit]);
        const counts = await query(`SELECT status, count(*)::text FROM notification_outbox GROUP BY status ORDER BY status`);
        return {
            rows,
            counts: Object.fromEntries(counts.map((c) => [c.status, parseInt(c.count, 10)])),
            total: rows.length,
        };
    });
};
