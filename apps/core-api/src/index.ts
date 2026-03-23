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
import { cancelRequestRoutes } from './routes/cancelRequest';
import { expireRoutes } from './routes/expire';
import { debugRoutes } from './routes/debug';
import { conversionRoutes } from './routes/conversion';
import { corridorRoutes } from './routes/corridor';
import { authHook } from './hooks/auth';
import { initWebSocketServer, closeWebSocketServer } from './ws/broadcast';
import { startOutboxWorker, stopOutboxWorker } from './workers/notificationOutbox';
import { startCorridorTimeoutWorker, stopCorridorTimeoutWorker } from './workers/corridorTimeoutWorker';
import { startAutoBumpWorker, stopAutoBumpWorker } from './workers/autoBumpWorker';
import { startPriceFeedWorker, stopPriceFeedWorker } from './workers/priceFeedWorker';
import { startUnhappyPathWorker, stopUnhappyPathWorker } from './workers/unhappyPathWorker';
import { startReceiptWorker, stopReceiptWorker } from './workers/receiptWorker';
import { closeReceiptQueue } from './queues/receiptQueue';
import { registerAllListeners } from './events';
import { closePool } from 'settlement-core';

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

// Mitigate CVE-2025-fastify-content-type-bypass (fastify <5.7.2):
// Strip tab/newline chars from Content-Type before Fastify parses it.
fastify.addHook('onRequest', async (request) => {
  const ct = request.headers['content-type'];
  if (ct && /[\t\r\n]/.test(ct)) {
    request.headers['content-type'] = ct.replace(/[\t\r\n]/g, '');
  }
});

// Register event listeners (before routes so they're ready when first request arrives)
registerAllListeners();

// Register auth hook (before routes)
await fastify.register(authHook);

// Register routes
await fastify.register(healthRoutes);
await fastify.register(orderRoutes, { prefix: '/v1' });
await fastify.register(orderCreateRoutes, { prefix: '/v1' });
await fastify.register(escrowRoutes, { prefix: '/v1' });
await fastify.register(extensionRoutes, { prefix: '/v1' });
await fastify.register(disputeRoutes, { prefix: '/v1' });
await fastify.register(cancelRequestRoutes, { prefix: '/v1' });
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
    startAutoBumpWorker();
    startPriceFeedWorker();
    startUnhappyPathWorker();
    await startReceiptWorker();
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
    stopAutoBumpWorker();
    stopPriceFeedWorker();
    stopUnhappyPathWorker();
    await stopReceiptWorker();
    await closeReceiptQueue();
    closeWebSocketServer();
  }
  await fastify.close();
  await closePool();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
