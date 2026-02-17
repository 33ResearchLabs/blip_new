// Load env FIRST — before any modules that read process.env at import time
// (e.g. settlement-core's MOCK_MODE constant)
import './loadEnv';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health';
import { orderRoutes } from './routes/orders';
import { orderCreateRoutes } from './routes/orderCreate';
import { escrowRoutes } from './routes/escrow';
import { extensionRoutes } from './routes/extension';
import { disputeRoutes } from './routes/dispute';
import { expireRoutes } from './routes/expire';
import { debugRoutes } from './routes/debug';
import { conversionRoutes } from './routes/conversion';
import { corridorRoutes } from './routes/corridor';
import { authHook } from './hooks/auth';
import { initWebSocketServer, closeWebSocketServer } from './ws/broadcast';
import { startOutboxWorker, stopOutboxWorker } from './workers/notificationOutbox';
import { startCorridorTimeoutWorker, stopCorridorTimeoutWorker } from './workers/corridorTimeoutWorker';

const PORT = parseInt(process.env.CORE_API_PORT || '4010', 10);
const HOST = process.env.CORE_API_HOST || '0.0.0.0';
const IS_WORKER = process.env.WORKER_ID !== undefined;

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'warn',
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
await fastify.register(conversionRoutes, { prefix: '/v1' });
await fastify.register(corridorRoutes, { prefix: '/v1' });
await fastify.register(debugRoutes);

// Start server
try {
  await fastify.listen({ port: PORT, host: HOST });
  console.log(`Core API [${IS_WORKER ? 'worker ' + process.env.WORKER_ID : 'standalone'}] running on http://${HOST}:${PORT}`);

  // Only primary (non-worker) runs WS + background workers
  if (!IS_WORKER) {
    initWebSocketServer(fastify.server);
    startOutboxWorker();
    startCorridorTimeoutWorker();
  }
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}

// Graceful shutdown
const shutdown = async (signal: string) => {
  if (!IS_WORKER) {
    stopOutboxWorker();
    stopCorridorTimeoutWorker();
    closeWebSocketServer();
  }
  await fastify.close();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
