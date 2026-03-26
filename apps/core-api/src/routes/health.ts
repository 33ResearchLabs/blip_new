import type { FastifyPluginAsync } from 'fastify';
import { queryOne } from 'settlement-core';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async () => {
    return {
      ok: true,
      service: 'core-api',
      timestamp: new Date().toISOString(),
    };
  });

  fastify.get('/health/db', async (_request, reply) => {
    try {
      const start = Date.now();
      const result = await queryOne<{ db_name: string; migration_version: string }>(
        `SELECT current_database() AS db_name,
                COALESCE(
                  (SELECT filename FROM schema_migrations ORDER BY id DESC LIMIT 1),
                  'unknown'
                ) AS migration_version`
      );
      const latencyMs = Date.now() - start;

      return {
        ok: true,
        service: 'core-api',
        database: result?.db_name ?? 'unknown',
        migration_version: result?.migration_version ?? 'unknown',
        latency_ms: latencyMs,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      reply.status(503);
      return {
        ok: false,
        service: 'core-api',
        error: 'Database health check failed',
        timestamp: new Date().toISOString(),
      };
    }
  });
};
