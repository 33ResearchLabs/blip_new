import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from 'dotenv';
import { healthRoutes } from './routes/health';
import { orderRoutes } from './routes/orders';
import { orderCreateRoutes } from './routes/orderCreate';
import { escrowRoutes } from './routes/escrow';
import { extensionRoutes } from './routes/extension';
import { disputeRoutes } from './routes/dispute';
import { expireRoutes } from './routes/expire';
import { debugRoutes } from './routes/debug';
import { authHook } from './hooks/auth';
import { initWebSocketServer, closeWebSocketServer } from './ws/broadcast';

// Load env from settle directory (shared config)
config({ path: '../../settle/.env.local' });
config({ path: '../../settle/.env' });

const PORT = parseInt(process.env.CORE_API_PORT || '4010', 10);
const HOST = process.env.CORE_API_HOST || '0.0.0.0';

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
});

// Register CORS
await fastify.register(cors, {
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
});

// Register auth hook (before routes)
await fastify.register(authHook);

// Register routes
await fastify.register(healthRoutes);
await fastify.register(orderRoutes, { prefix: '/v1' });
await fastify.register(orderCreateRoutes, { prefix: '/v1' });
await fastify.register(escrowRoutes, { prefix: '/v1' });
await fastify.register(extensionRoutes, { prefix: '/v1' });
await fastify.register(disputeRoutes, { prefix: '/v1' });
await fastify.register(expireRoutes, { prefix: '/v1' });
await fastify.register(debugRoutes);

// Start server
try {
  await fastify.listen({ port: PORT, host: HOST });
  console.log(`Core API running on http://${HOST}:${PORT}`);

  // Attach WS server to the same HTTP server
  initWebSocketServer(fastify.server);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}

// Graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`\n${signal} received, shutting down gracefully...`);
  closeWebSocketServer();
  await fastify.close();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
