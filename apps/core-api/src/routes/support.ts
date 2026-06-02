import type { FastifyInstance } from 'fastify';
import { query, queryOne } from 'settlement-core';

const ADMIN_SECRET = process.env.SUPPORT_ADMIN_SECRET || 'support-admin-dev';

function isAdmin(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  return req.headers['x-support-admin-secret'] === ADMIN_SECRET;
}

export async function supportRoutes(fastify: FastifyInstance): Promise<void> {
  // Get messages for a session (user fetches their own; admin fetches any)
  fastify.get('/support/sessions/:sessionId/messages', async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const actorId = req.headers['x-actor-id'] as string | undefined;

    if (!isAdmin(req as any)) {
      // Verify this session belongs to the requesting actor
      const session = await queryOne<{ actor_id: string }>(
        `SELECT actor_id FROM support_sessions WHERE id=$1`, [sessionId],
      );
      if (!session || session.actor_id !== actorId) return reply.status(403).send({ error: 'forbidden' });
    }

    const messages = await query(
      `SELECT id, sender, content, created_at FROM support_messages WHERE session_id=$1 ORDER BY created_at ASC LIMIT 200`,
      [sessionId],
    );
    return { messages };
  });

  // Admin: list all sessions
  fastify.get('/support/sessions', async (req, reply) => {
    if (!isAdmin(req as any)) return reply.status(403).send({ error: 'forbidden' });
    const status = (req.query as { status?: string }).status || 'open';
    const sessions = await query(
      `SELECT id, actor_type, actor_id, display_name, status, last_message_at, last_message_preview, unread_admin, created_at
       FROM support_sessions WHERE status=$1 ORDER BY COALESCE(last_message_at, created_at) DESC LIMIT 100`,
      [status],
    );
    return { sessions };
  });

  // Admin: resolve a session
  fastify.post('/support/sessions/:sessionId/resolve', async (req, reply) => {
    if (!isAdmin(req as any)) return reply.status(403).send({ error: 'forbidden' });
    const { sessionId } = req.params as { sessionId: string };
    await query(`UPDATE support_sessions SET status='resolved', updated_at=NOW() WHERE id=$1`, [sessionId]);
    return { ok: true };
  });

  // User: get or create their open session
  fastify.get('/support/session', async (req, reply) => {
    const actorType = req.headers['x-actor-type'] as string | undefined;
    const actorId = req.headers['x-actor-id'] as string | undefined;
    if (!actorType || !actorId) return reply.status(400).send({ error: 'missing actor' });

    let session = await queryOne<{ id: string; status: string }>(
      `SELECT id, status FROM support_sessions WHERE actor_type=$1 AND actor_id=$2 AND status='open' ORDER BY created_at DESC LIMIT 1`,
      [actorType, actorId],
    );
    if (!session) {
      const rows = await query<{ id: string }>(
        `INSERT INTO support_sessions (actor_type, actor_id, display_name) VALUES ($1, $2, $3) RETURNING id`,
        [actorType, actorId, actorId],
      );
      session = { id: rows[0].id, status: 'open' };
    }
    return { session };
  });
}
